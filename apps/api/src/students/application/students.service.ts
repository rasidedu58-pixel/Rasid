import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type {
  CreateStudentRequest,
  CreateStudentResponse,
  GuardianLink,
  LinkGuardianRequest,
  ListStudentsResponse,
  MatchPreviewRequest,
  MatchPreviewResponse,
  QrIssueResponse,
  QrReissueRequest,
  QrResolveRequest,
  QrResolveResponse,
  Student,
  StudentDetailResponse,
  UpdateStudentGuardianRequest,
  UpdateStudentRequest,
} from "@academic-precision/contracts";
import { normalizeArabicName, normalizePhone } from "@academic-precision/database";
import type { GuardianRow, StudentGuardianWithGuardian, StudentRow } from "@academic-precision/database";
import {
  QrAlreadyActiveException,
  QrInvalidException,
  ResourceNotFoundException,
  ValidationApiException,
  VersionConflictException,
} from "../../common/exceptions/api.exception";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import type { WorkspaceContext } from "../../team/api/guards/permission.guard";
import { PermissionResolverService, type EffectiveGrant } from "../../team/application/permission-resolver.service";
import { STUDENTS_REPOSITORY, type StudentsRepositoryPort } from "./ports/students-repository.port";

const DEFAULT_LIST_LIMIT = 50;
const GLOBAL_CONTEXT = "GLOBAL";
type ScopedPermission = "students.view_basic" | "students.edit";

/**
 * Application service for Phase 4 Students / Guardians / QR endpoints.
 * Controllers stay thin; all authorization/business rules live here,
 * mirroring the Phase 1-3 convention.
 *
 * Scope-check design (Student Group-Scope Security Delta, superseding the
 * Phase 4 handoff's original "coarse workspace-wide check" decision, which
 * PRD §12/§17 and API Contract §10 do NOT actually support — both name
 * "Group scope" explicitly for `students.view_basic`/`students.edit`):
 * `students`/`guardians` tables carry NO group_id column at all — a Student
 * is not inherently anchored to any one Group (they accumulate Enrollments
 * across groups/months over time). Enrollment (via GroupMonth → Group) is
 * therefore the only real link, and `listGroupIdsForStudent` /
 * `StudentSearchFilter.restrictToGroupIds` (packages/database) are the
 * mechanism: for a SELECTED_GROUPS caller, a Student is in scope iff they
 * have (or have had) at least one Enrollment tied to a GroupMonth of one of
 * the caller's granted groups — regardless of that Enrollment's current
 * status (ACTIVE/WITHDRAWN/TRANSFERRED/etc.), so a since-withdrawn student
 * a caller once managed stays visible to them. A caller with ALL_GROUPS
 * (including Owner) is never restricted. Every Student/Guardian/QR
 * operation below funnels through `loadStudentInScope`/
 * `resolveGroupScopeFilter`/`assertStudentGroupScope` to enforce this
 * server-side — never relying on client-side/UI hiding.
 */
@Injectable()
export class StudentsService {
  constructor(
    @Inject(STUDENTS_REPOSITORY) private readonly repository: StudentsRepositoryPort,
    private readonly permissionResolver: PermissionResolverService,
  ) {}

  // ---------------------------------------------------------------------
  // Students
  // ---------------------------------------------------------------------

  async listStudents(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    query: { q?: string; searchBy?: "name" | "code" | "guardianPhone"; cursor?: string; limit?: number },
  ): Promise<ListStudentsResponse> {
    const limit = Math.min(query.limit ?? DEFAULT_LIST_LIMIT, 200);

    let normalizedNameQuery: string | undefined;
    let studentCode: string | undefined;
    let guardianNormalizedPhone: string | undefined;

    if (query.q) {
      const mode = query.searchBy ?? this.inferSearchMode(query.q);
      if (mode === "code") {
        studentCode = query.q.trim();
      } else if (mode === "guardianPhone") {
        guardianNormalizedPhone = normalizePhone(query.q);
      } else {
        normalizedNameQuery = normalizeArabicName(query.q);
      }
    }

    // Phase 15C latency fix — reuse the grant `PermissionGuard` already
    // resolved for this route's required permission (students.view_basic)
    // instead of re-resolving it, which re-queried membership + grants.
    // The stored grant is exactly what `resolveGroupScopeFilter` computes;
    // if for any reason it is absent (e.g. a caller path without the guard),
    // fall back to the original resolve so behaviour is never weakened.
    const restrictToGroupIds =
      workspaceContext.grant && workspaceContext.grant.permission === "students.view_basic"
        ? this.scopeFilterFromGrant(workspaceContext.grant)
        : await this.resolveGroupScopeFilter(workspaceContext.workspaceId, authUser.id, "students.view_basic");

    const rows = await this.repository.searchStudents({
      workspaceId: workspaceContext.workspaceId,
      normalizedNameQuery,
      studentCode,
      guardianNormalizedPhone,
      limit: limit + 1,
      cursorId: query.cursor ?? undefined,
      restrictToGroupIds,
    });

    const hasNext = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];

    // Phase 15 fix — fuzzy name search orders by similarity() DESC, which
    // an `id >` cursor cannot correctly page through (rows would be both
    // skipped and repeated). A name search is a "refine your query" UX,
    // not a deep-paging one, so it now honestly reports no next page
    // instead of emitting a corrupt cursor. Code/phone/plain-list paths
    // keep real id-cursor pagination (their ordering matches the cursor).
    const cursorablePage = !normalizedNameQuery;

    return {
      items: items.map((s) => this.toStudentDto(s)),
      page: {
        hasNext: hasNext && cursorablePage,
        nextCursor: hasNext && cursorablePage && last ? last.id : null,
      },
    };
  }

  /** Heuristic auto-detection when the caller doesn't pass an explicit `searchBy`. */
  private inferSearchMode(q: string): "name" | "code" | "guardianPhone" {
    const trimmed = q.trim();
    if (/^AP-/i.test(trimmed)) return "code";
    if (/^[+\d\s\-()٠-٩]+$/.test(trimmed) && normalizePhone(trimmed).length >= 6) return "guardianPhone";
    return "name";
  }

  async matchPreview(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    body: MatchPreviewRequest,
  ): Promise<MatchPreviewResponse> {
    const candidates: MatchPreviewResponse["candidates"] = [];
    const seen = new Set<string>();

    // match-preview is gated on students.edit (StudentsController) — same
    // permission its scope is resolved against, never leaking a Group B
    // candidate to a caller SELECTED_GROUPS-restricted to Group A.
    const restrictToGroupIds = await this.resolveGroupScopeFilter(
      workspaceContext.workspaceId,
      authUser.id,
      "students.edit",
    );

    const normalizedName = normalizeArabicName(body.name);
    const nameMatches = await this.repository.searchStudents({
      workspaceId: workspaceContext.workspaceId,
      normalizedNameQuery: normalizedName,
      limit: 10,
      restrictToGroupIds,
    });
    for (const s of nameMatches) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      candidates.push({ studentId: s.id, studentCode: s.studentCode, name: s.name, matchedBy: "NAME" });
    }

    if (body.guardianPhone) {
      const normalizedPhone = normalizePhone(body.guardianPhone);
      const phoneMatches = await this.repository.searchStudents({
        workspaceId: workspaceContext.workspaceId,
        guardianNormalizedPhone: normalizedPhone,
        limit: 10,
        restrictToGroupIds,
      });
      for (const s of phoneMatches) {
        if (seen.has(s.id)) continue;
        seen.add(s.id);
        candidates.push({ studentId: s.id, studentCode: s.studentCode, name: s.name, matchedBy: "GUARDIAN_PHONE" });
      }
    }

    return { candidates };
  }

  async createStudent(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    body: CreateStudentRequest,
    correlationId: string | null,
  ): Promise<CreateStudentResponse> {
    const studentCode = await this.repository.generateUniqueStudentCode(workspaceContext.workspaceId);
    const student = await this.repository.insertStudent({
      workspaceId: workspaceContext.workspaceId,
      studentCode,
      name: body.name,
      searchNameNormalized: normalizeArabicName(body.name),
    });

    const guardianInputs = body.guardians ?? [];
    const explicitPrimaryCount = guardianInputs.filter((g) => g.isPrimary === true).length;
    if (explicitPrimaryCount > 1) {
      throw new ValidationApiException({ guardians: ["يمكن تحديد ولي أمر أساسي واحد فقط."] });
    }

    const guardianLinks: GuardianLink[] = [];
    for (const [index, guardianInput] of guardianInputs.entries()) {
      // No automatic guardian merge by phone match (explicitly prohibited)
      // — always a fresh guardians row per guardian supplied here.
      const guardian = await this.repository.insertGuardian({
        workspaceId: workspaceContext.workspaceId,
        name: guardianInput.name ?? null,
        phone: guardianInput.phone,
        normalizedPhone: normalizePhone(guardianInput.phone),
      });

      // Default: if none of the supplied guardians is explicitly marked
      // primary, the FIRST one defaults to primary (documented default —
      // see Phase 4 handoff DEVIATIONS).
      const isPrimary =
        guardianInput.isPrimary === true || (explicitPrimaryCount === 0 && index === 0);

      const link = await this.repository.insertStudentGuardian({
        workspaceId: workspaceContext.workspaceId,
        studentId: student.id,
        guardianId: guardian.id,
        relationship: guardianInput.relationship ?? null,
        isPrimary,
        academicContactEnabled: guardianInput.academicContactEnabled ?? true,
        financialContactEnabled: guardianInput.financialContactEnabled ?? true,
      });

      guardianLinks.push(this.toGuardianLinkDto(link, guardian));
    }

    const { rawToken, credential } = await this.issueQrInternal(workspaceContext.workspaceId, student.id, authUser.id);

    await this.repository.insertAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      actorUserId: authUser.id,
      actorMembershipId: workspaceContext.membership.id,
      action: "student.created",
      entityType: "student",
      entityId: student.id,
      afterJson: { student: this.toStudentDto(student), guardianCount: guardianLinks.length },
      correlationId,
    });

    return {
      student: this.toStudentDto(student),
      guardians: guardianLinks,
      qr: { credentialId: credential.id, displayToken: rawToken },
    };
  }

  async getStudent(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    id: string,
  ): Promise<StudentDetailResponse> {
    const student = await this.loadStudentInScope(authUser.id, workspaceContext, id, "students.view_basic");
    const links = await this.repository.listGuardiansForStudent(student.id);
    const activeQr = await this.repository.findActiveQrForStudent(student.id);

    return {
      student: this.toStudentDto(student),
      guardians: links.map(({ link, guardian }) => this.toGuardianLinkDto(link, guardian)),
      qr: { hasActive: !!activeQr, credentialId: activeQr?.id ?? null },
    };
  }

  async updateStudent(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    id: string,
    body: UpdateStudentRequest,
    correlationId: string | null,
  ): Promise<Student> {
    const before = await this.loadStudentInScope(authUser.id, workspaceContext, id, "students.edit");

    const patch: { name?: string; searchNameNormalized?: string } = {};
    if (body.name !== undefined) {
      patch.name = body.name;
      patch.searchNameNormalized = normalizeArabicName(body.name);
    }

    const updated = await this.repository.updateStudentWithVersion(id, body.version, patch);
    if (!updated) {
      throw new VersionConflictException(undefined, { currentVersion: before.version });
    }

    await this.repository.insertAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      actorUserId: authUser.id,
      actorMembershipId: workspaceContext.membership.id,
      action: "student.updated",
      entityType: "student",
      entityId: updated.id,
      beforeJson: this.toStudentDto(before),
      afterJson: this.toStudentDto(updated),
      correlationId,
    });

    return this.toStudentDto(updated);
  }

  async archiveStudent(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    id: string,
    correlationId: string | null,
  ): Promise<Student> {
    const before = await this.loadStudentInScope(authUser.id, workspaceContext, id, "students.edit");

    const updated = await this.repository.updateStudentWithVersion(id, before.version, {
      status: "ARCHIVED",
      archivedAt: new Date(),
    });
    if (!updated) {
      throw new VersionConflictException(undefined, { currentVersion: before.version });
    }

    await this.repository.insertAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      actorUserId: authUser.id,
      actorMembershipId: workspaceContext.membership.id,
      action: "student.archived",
      entityType: "student",
      entityId: updated.id,
      beforeJson: this.toStudentDto(before),
      afterJson: this.toStudentDto(updated),
      correlationId,
    });

    return this.toStudentDto(updated);
  }

  // ---------------------------------------------------------------------
  // Guardians
  // ---------------------------------------------------------------------

  async linkGuardian(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    studentId: string,
    body: LinkGuardianRequest,
    correlationId: string | null,
  ): Promise<GuardianLink> {
    const student = await this.loadStudentInScope(authUser.id, workspaceContext, studentId, "students.edit");

    let guardian: GuardianRow;
    if (body.guardianId) {
      const existing = await this.repository.findGuardianById(body.guardianId);
      if (!existing || existing.workspaceId !== workspaceContext.workspaceId) {
        throw new ResourceNotFoundException();
      }
      guardian = existing;
    } else {
      if (!body.phone) {
        throw new ValidationApiException({ phone: ["مطلوب عند إنشاء ولي أمر جديد."] });
      }
      guardian = await this.repository.insertGuardian({
        workspaceId: workspaceContext.workspaceId,
        name: body.name ?? null,
        phone: body.phone,
        normalizedPhone: normalizePhone(body.phone),
      });
    }

    const existingLinks = await this.repository.listGuardiansForStudent(student.id);
    const isPrimary = body.isPrimary === true || existingLinks.length === 0;

    const link = await this.repository.insertStudentGuardian({
      workspaceId: workspaceContext.workspaceId,
      studentId: student.id,
      guardianId: guardian.id,
      relationship: body.relationship ?? null,
      isPrimary: false, // insert non-primary first, then atomically promote via setPrimaryGuardianTransaction below if needed — avoids ever having two primaries mid-operation
      academicContactEnabled: body.academicContactEnabled ?? true,
      financialContactEnabled: body.financialContactEnabled ?? true,
    });

    const finalLink = isPrimary
      ? await this.repository.setPrimaryGuardianTransaction(student.id, link.id)
      : link;
    if (!finalLink) throw new ResourceNotFoundException();

    await this.repository.insertAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      actorUserId: authUser.id,
      actorMembershipId: workspaceContext.membership.id,
      action: "guardian.linked",
      entityType: "student_guardian",
      entityId: finalLink.id,
      afterJson: this.toGuardianLinkDto(finalLink, guardian),
      correlationId,
    });

    return this.toGuardianLinkDto(finalLink, guardian);
  }

  async updateStudentGuardian(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    studentId: string,
    guardianLinkId: string,
    body: UpdateStudentGuardianRequest,
    correlationId: string | null,
  ): Promise<GuardianLink> {
    await this.loadStudentInScope(authUser.id, workspaceContext, studentId, "students.edit");
    const before = await this.loadGuardianLinkForStudent(workspaceContext, studentId, guardianLinkId);

    const updated = await this.repository.updateStudentGuardian(guardianLinkId, {
      relationship: body.relationship,
      academicContactEnabled: body.academicContactEnabled,
      financialContactEnabled: body.financialContactEnabled,
    });
    if (!updated) throw new ResourceNotFoundException();

    const guardian = await this.repository.findGuardianById(updated.guardianId);
    if (!guardian) throw new ResourceNotFoundException();

    await this.repository.insertAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      actorUserId: authUser.id,
      actorMembershipId: workspaceContext.membership.id,
      action: "student_guardian.updated",
      entityType: "student_guardian",
      entityId: updated.id,
      beforeJson: this.toGuardianLinkDto(before.link, before.guardian),
      afterJson: this.toGuardianLinkDto(updated, guardian),
      correlationId,
    });

    return this.toGuardianLinkDto(updated, guardian);
  }

  async setPrimaryGuardian(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    studentId: string,
    guardianLinkId: string,
    correlationId: string | null,
  ): Promise<GuardianLink> {
    await this.loadStudentInScope(authUser.id, workspaceContext, studentId, "students.edit");
    await this.loadGuardianLinkForStudent(workspaceContext, studentId, guardianLinkId);

    const updated = await this.repository.setPrimaryGuardianTransaction(studentId, guardianLinkId);
    if (!updated) throw new ResourceNotFoundException();

    const guardian = await this.repository.findGuardianById(updated.guardianId);
    if (!guardian) throw new ResourceNotFoundException();

    await this.repository.insertAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      actorUserId: authUser.id,
      actorMembershipId: workspaceContext.membership.id,
      action: "student_guardian.primary_set",
      entityType: "student_guardian",
      entityId: updated.id,
      afterJson: this.toGuardianLinkDto(updated, guardian),
      correlationId,
    });

    return this.toGuardianLinkDto(updated, guardian);
  }

  // ---------------------------------------------------------------------
  // QR
  // ---------------------------------------------------------------------

  async issueQr(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    studentId: string,
    correlationId: string | null,
  ): Promise<QrIssueResponse> {
    const student = await this.loadStudentInScope(authUser.id, workspaceContext, studentId, "students.edit");
    const active = await this.repository.findActiveQrForStudent(student.id);
    if (active) {
      throw new QrAlreadyActiveException();
    }

    const { rawToken, credential } = await this.issueQrInternal(workspaceContext.workspaceId, student.id, authUser.id);

    await this.repository.insertAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      actorUserId: authUser.id,
      actorMembershipId: workspaceContext.membership.id,
      action: "qr.issued",
      entityType: "qr_credential",
      entityId: credential.id,
      afterJson: { studentId: student.id },
      correlationId,
    });

    return { credentialId: credential.id, displayToken: rawToken };
  }

  async reissueQr(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    studentId: string,
    body: QrReissueRequest,
    correlationId: string | null,
  ): Promise<QrIssueResponse> {
    const student = await this.loadStudentInScope(authUser.id, workspaceContext, studentId, "students.edit");
    const rawToken = this.generateRawQrToken();
    const tokenHash = this.hashQrToken(rawToken);

    const { issued } = await this.repository.reissueQrCredentialTransaction({
      workspaceId: workspaceContext.workspaceId,
      studentId: student.id,
      newTokenHash: tokenHash,
      issuedByUserId: authUser.id,
      revokedByUserId: authUser.id,
      revokeReason: body.reason ?? "REISSUED",
    });

    await this.repository.insertAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      actorUserId: authUser.id,
      actorMembershipId: workspaceContext.membership.id,
      action: "qr.reissued",
      entityType: "qr_credential",
      entityId: issued.id,
      afterJson: { studentId: student.id },
      reason: body.reason ?? null,
      correlationId,
    });

    return { credentialId: issued.id, displayToken: rawToken };
  }

  /**
   * Phase 4 pre-authorized scoping decision #2: only GLOBAL context is
   * implemented. SESSION (validate against a current live session) and
   * PAYMENT (authorized financial status) contexts don't exist yet — Session
   * Mode is Phase 5, Finance is Phase 6 — so they are explicitly REJECTED
   * with a validation error rather than silently treated as GLOBAL.
   */
  async resolveQr(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    body: QrResolveRequest,
  ): Promise<QrResolveResponse> {
    if (body.context !== GLOBAL_CONTEXT) {
      throw new ValidationApiException({
        context: [`سياق "${body.context}" غير مدعوم بعد — فقط GLOBAL متاح في هذه المرحلة.`],
      });
    }

    const tokenHash = this.hashQrToken(body.token);
    const credential = await this.repository.findQrByTokenHash(tokenHash);
    // Safe no-leak: identical QR_INVALID response whether the token is
    // genuinely unknown, revoked, or belongs to a different workspace.
    if (!credential || credential.workspaceId !== workspaceContext.workspaceId) {
      throw new QrInvalidException();
    }

    const student = await this.repository.findStudentById(credential.studentId);
    if (!student || student.workspaceId !== workspaceContext.workspaceId) {
      throw new QrInvalidException();
    }

    // Group-Scope Security Delta: GLOBAL QR resolve must never become a
    // bypass around Group Scope — a SELECTED_GROUPS caller scanning a
    // Group B student's QR gets the exact same QR_INVALID as an unknown/
    // revoked token (no distinction that would confirm the student exists
    // but is out of scope).
    if (!(await this.isStudentInScope(workspaceContext.workspaceId, authUser.id, "students.view_basic", student.id))) {
      throw new QrInvalidException();
    }

    return { studentId: student.id, studentCode: student.studentCode, name: student.name };
  }

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  private async issueQrInternal(workspaceId: string, studentId: string, issuedByUserId: string) {
    const rawToken = this.generateRawQrToken();
    const tokenHash = this.hashQrToken(rawToken);
    const credential = await this.repository.issueQrCredential({
      workspaceId,
      studentId,
      tokenHash,
      issuedByUserId,
    });
    return { rawToken, credential };
  }

  /** High-entropy, opaque, no-PII raw token (API Contract §33.3) — never persisted, only its SHA-256 hash. */
  private generateRawQrToken(): string {
    return randomBytes(32).toString("base64url");
  }

  private hashQrToken(rawToken: string): string {
    return createHash("sha256").update(rawToken).digest("hex");
  }

  /**
   * Loads a Student that must exist in this workspace AND be within the
   * caller's Group Scope for `permission` — 404 (safe no-leak, no
   * distinction from "does not exist") on either failure. Replaces the
   * former workspace-only `loadStudentInWorkspace` (see class doc comment).
   */
  private async loadStudentInScope(
    authUserId: string,
    workspaceContext: WorkspaceContext,
    studentId: string,
    permission: ScopedPermission,
  ): Promise<StudentRow> {
    const student = await this.repository.findStudentById(studentId);
    if (!student || student.workspaceId !== workspaceContext.workspaceId) {
      throw new ResourceNotFoundException();
    }
    if (!(await this.isStudentInScope(workspaceContext.workspaceId, authUserId, permission, student.id))) {
      throw new ResourceNotFoundException();
    }
    return student;
  }

  /**
   * Resolves the group-id restriction to apply to a `searchStudents` call
   * for `permission`: `undefined` means unrestricted (ALL_GROUPS/Owner),
   * an array (possibly empty) means restrict to students with an
   * Enrollment tied to one of these groups. Mirrors
   * `PermissionResolverService.isGroupInScope`'s own grant lookup but
   * returns the full group-id set rather than testing one id, since
   * search needs to filter a result set, not gate one resource.
   */
  private async resolveGroupScopeFilter(
    workspaceId: string,
    authUserId: string,
    permission: ScopedPermission,
  ): Promise<string[] | undefined> {
    const grant = await this.permissionResolver.hasPermission(workspaceId, authUserId, permission);
    return this.scopeFilterFromGrant(grant);
  }

  /**
   * Phase 15C — the pure grant → group-scope-filter mapping, factored out so
   * a pre-resolved grant (from `PermissionGuard`, stored on the request
   * context) can be reused without another permission resolution. Identical
   * semantics to the tail of `resolveGroupScopeFilter`: `undefined` =
   * unrestricted (ALL_GROUPS/Owner), `[]` = no grant (deny — belt-and-braces,
   * the guard already required the permission), otherwise the granted groups.
   */
  private scopeFilterFromGrant(grant: EffectiveGrant | undefined): string[] | undefined {
    if (!grant) return [];
    if (grant.scope === "ALL_GROUPS") return undefined;
    return grant.groupIds ?? [];
  }

  /** Single-student version of {@link resolveGroupScopeFilter} — is `studentId` within the caller's Group Scope for `permission`? */
  private async isStudentInScope(
    workspaceId: string,
    authUserId: string,
    permission: ScopedPermission,
    studentId: string,
  ): Promise<boolean> {
    const restrict = await this.resolveGroupScopeFilter(workspaceId, authUserId, permission);
    if (restrict === undefined) return true; // ALL_GROUPS/Owner
    if (restrict.length === 0) return false;
    const studentGroupIds = await this.repository.listGroupIdsForStudent(studentId);
    const allowed = new Set(restrict);
    return studentGroupIds.some((id) => allowed.has(id));
  }

  private async loadGuardianLinkForStudent(
    workspaceContext: WorkspaceContext,
    studentId: string,
    guardianLinkId: string,
  ): Promise<StudentGuardianWithGuardian> {
    const links = await this.repository.listGuardiansForStudent(studentId);
    const found = links.find((l) => l.link.id === guardianLinkId);
    if (!found || found.link.workspaceId !== workspaceContext.workspaceId) {
      throw new ResourceNotFoundException();
    }
    return found;
  }

  // ---------------------------------------------------------------------
  // DTO mappers
  // ---------------------------------------------------------------------

  private toStudentDto(row: StudentRow): Student {
    return {
      id: row.id,
      studentCode: row.studentCode,
      name: row.name,
      status: row.status as Student["status"],
      version: row.version,
    };
  }

  private toGuardianLinkDto(
    link: { id: string; guardianId: string; relationship: string | null; isPrimary: boolean; academicContactEnabled: boolean; financialContactEnabled: boolean },
    guardian: GuardianRow,
  ): GuardianLink {
    // Phase 4 pre-authorized decision #4: students.view_basic callers may
    // see the full guardian phone (no separate "masked vs full" permission
    // exists in the Phase 2 catalog) — never masked here.
    return {
      id: link.id,
      guardianId: link.guardianId,
      name: guardian.name,
      phone: guardian.phone,
      relationship: link.relationship,
      isPrimary: link.isPrimary,
      academicContactEnabled: link.academicContactEnabled,
      financialContactEnabled: link.financialContactEnabled,
    };
  }
}
