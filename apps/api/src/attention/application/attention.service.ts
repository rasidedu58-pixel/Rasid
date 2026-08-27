import { Inject, Injectable } from "@nestjs/common";
import type {
  AttentionCase,
  AttentionCaseSummary,
  AttentionCaseTransitionResponse,
  CompleteFollowupRequest,
  ContactDraftRequest,
  ContactDraftResponse,
  CreateContactLogRequest,
  CreateContactLogResponse,
  FollowupActionResponse,
  ListAttentionCasesResponse,
  ListFollowupsResponse,
  RescheduleFollowupRequest,
} from "@academic-precision/contracts";
import {
  computeVisiblePriority,
  type AttentionCaseRow,
  type AttentionReasonRow,
  type ContactLogRow,
  type ScheduledFollowupRow,
} from "@academic-precision/database";
import {
  AttentionCaseInvalidStateException,
  FollowupInvalidStateException,
  GuardianContactDisabledException,
  ResourceNotFoundException,
  ValidationApiException,
  VersionConflictException,
} from "../../common/exceptions/api.exception";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import type { WorkspaceContext } from "../../team/api/guards/permission.guard";
import { PermissionResolverService, type EffectiveGrant } from "../../team/application/permission-resolver.service";
import { ATTENTION_REPOSITORY, type AttentionRepositoryPort } from "./ports/attention-repository.port";

const DEFAULT_LIST_LIMIT = 50;

type ScopedPermission = "followup.read" | "followup.write" | "parent_contact";

const ATTENDANCE_LABELS: Record<string, string> = {
  PRESENT: "حاضر",
  ABSENT: "غائب",
  LATE: "متأخر",
};

const HOMEWORK_LABELS: Record<string, string> = {
  DONE: "تم الأداء",
  PARTIAL: "أداء جزئي",
  NOT_DONE: "لم يُؤدَّ",
  NO_HOMEWORK: "لا يوجد واجب",
};

/**
 * Application service for Phase 7 Attention/Follow-up endpoints.
 * Controllers stay thin; all authorization/business rules live here,
 * mirroring the Phase 1-6 `FinanceService`/`SchedulingService` convention.
 *
 * Group Scope for `attention_cases`/`contact_logs`/`scheduled_followups` is
 * resolved TRANSITIVELY via each Reason's own `group_id` (never via the
 * Student's CURRENT enrollments, since a Case persists across months and
 * groups — see the Attention Case + multi-group security correction): a
 * Case is visible to a SELECTED_GROUPS caller iff at least one of its
 * Reasons is in one of the caller's granted groups, and every rendered
 * field (`reasons`, `evidence`, and the computed `priority` itself) is
 * filtered/derived from ONLY that visible subset — never the full,
 * cross-group truth. `parent_contact`/`followup.write` writes (contact
 * drafts/logs) additionally re-validate the SPECIFIC session/group
 * involved before building anything, so a draft can never be built by
 * quoting a reason from an out-of-scope group.
 */
@Injectable()
export class AttentionService {
  constructor(
    @Inject(ATTENTION_REPOSITORY) private readonly repository: AttentionRepositoryPort,
    private readonly permissionResolver: PermissionResolverService,
  ) {}

  // ---------------------------------------------------------------------
  // Attention Cases
  // ---------------------------------------------------------------------

  async listAttentionCases(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    query: { status?: string; cursor?: string; limit?: number },
  ): Promise<ListAttentionCasesResponse> {
    // Phase 15C — reuse the "followup.read" grant PermissionGuard already
    // resolved for this exact route (from the SAME team repository the
    // resolver would query — safe, unlike /context's identity-side hint), so
    // the group-scope filter is derived without re-resolving permissions
    // (which re-queried membership + grants). If the stashed grant is for a
    // different permission (defensive — it never is on this route) we fall
    // back to a real resolution. Byte-identical scope, one fewer resolution.
    const restrictToGroupIds =
      workspaceContext.grant?.permission === "followup.read"
        ? this.scopeFilterFromGrant(workspaceContext.grant)
        : await this.resolveGroupScopeFilter(workspaceContext.workspaceId, authUser.id, "followup.read");
    const limit = Math.min(query.limit ?? DEFAULT_LIST_LIMIT, 200);

    // Phase 15C — cases, every case's Reasons (was an N+1), and the batched
    // student names all in ONE transaction. Slicing/scoping/priority logic
    // below is unchanged.
    const { cases, reasonsByCaseId, studentsById } = await this.repository.loadAttentionCaseList({
      workspaceId: workspaceContext.workspaceId,
      status: query.status,
      restrictToGroupIds,
      limit: limit + 1,
      cursorId: query.cursor ?? undefined,
    });

    const hasNext = cases.length > limit;
    const items = cases.slice(0, limit);
    const last = items[items.length - 1];

    const summaries: AttentionCaseSummary[] = [];
    for (const row of items) {
      const reasons = reasonsByCaseId.get(row.id) ?? [];
      const visibleReasons = this.filterReasonsToScope(reasons, restrictToGroupIds);
      const priority = computeVisiblePriority(visibleReasons.map((r) => ({ severity: r.severity as "MEDIUM" | "HIGH" })));
      if (!priority) continue; // defensive — listAttentionCasesForWorkspace already restricts to in-scope cases
      const student = studentsById.get(row.studentId);
      summaries.push(this.toCaseSummaryDto(row, priority, student?.name ?? "", student?.studentCode ?? ""));
    }

    return { items: summaries, page: { hasNext, nextCursor: hasNext && last ? last.id : null } };
  }

  async getAttentionCase(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    id: string,
  ): Promise<AttentionCase> {
    const { attentionCase, visibleReasons } = await this.loadCaseInScope(authUser, workspaceContext, id, "followup.read");
    return this.buildCaseDetailDto(attentionCase, visibleReasons);
  }

  async startFollowup(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    id: string,
    body: { version: number },
    correlationId: string | null,
  ): Promise<AttentionCaseTransitionResponse> {
    const { attentionCase: before } = await this.loadCaseInScope(authUser, workspaceContext, id, "followup.write");
    if (before.status !== "NEW") {
      throw new AttentionCaseInvalidStateException(undefined, { currentStatus: before.status });
    }
    return this.applyTransition(authUser, workspaceContext, before, body.version, "IN_FOLLOWUP", correlationId);
  }

  async markMonitoring(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    id: string,
    body: { version: number },
    correlationId: string | null,
  ): Promise<AttentionCaseTransitionResponse> {
    const { attentionCase: before } = await this.loadCaseInScope(authUser, workspaceContext, id, "followup.write");
    if (before.status !== "IN_FOLLOWUP" && before.status !== "CONTACTED") {
      throw new AttentionCaseInvalidStateException(undefined, { currentStatus: before.status });
    }
    return this.applyTransition(authUser, workspaceContext, before, body.version, "MONITORING", correlationId);
  }

  async closeCase(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    id: string,
    body: { version: number },
    correlationId: string | null,
  ): Promise<AttentionCaseTransitionResponse> {
    const { attentionCase: before } = await this.loadCaseInScope(authUser, workspaceContext, id, "followup.write");
    if (before.status === "CLOSED") {
      throw new AttentionCaseInvalidStateException(undefined, { currentStatus: before.status });
    }
    return this.applyTransition(authUser, workspaceContext, before, body.version, "CLOSED", correlationId);
  }

  private async applyTransition(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    before: AttentionCaseRow,
    expectedVersion: number,
    newStatus: "IN_FOLLOWUP" | "CONTACTED" | "MONITORING" | "CLOSED",
    correlationId: string | null,
  ): Promise<AttentionCaseTransitionResponse> {
    const updated = await this.repository.updateAttentionCaseStatusWithVersion({ id: before.id, expectedVersion, newStatus });
    if (!updated) {
      throw new VersionConflictException(undefined, { currentVersion: before.version });
    }
    await this.repository.insertAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      actorUserId: authUser.id,
      actorMembershipId: workspaceContext.membership.id,
      action: `attention_case.${newStatus.toLowerCase()}`,
      entityType: "attention_case",
      entityId: updated.id,
      beforeJson: { status: before.status },
      afterJson: { status: updated.status },
      correlationId,
    });
    const reasons = await this.repository.listAttentionReasonsForCase(updated.id);
    const restrictToGroupIds = await this.resolveGroupScopeFilter(workspaceContext.workspaceId, authUser.id, "followup.read");
    const visibleReasons = this.filterReasonsToScope(reasons, restrictToGroupIds);
    return { case: await this.buildCaseDetailDto(updated, visibleReasons) };
  }

  // ---------------------------------------------------------------------
  // Follow-ups
  // ---------------------------------------------------------------------

  async listFollowups(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    query: { status?: string; cursor?: string; limit?: number },
  ): Promise<ListFollowupsResponse> {
    const restrictToGroupIds = await this.resolveGroupScopeFilter(workspaceContext.workspaceId, authUser.id, "followup.read");
    const limit = Math.min(query.limit ?? DEFAULT_LIST_LIMIT, 200);

    // Phase 15 fix — cursor now matches the (due_at, id) sort order (see
    // the repository's own comment). Encoded opaquely as "<epochMs>_<id>";
    // an old-format (plain id) cursor fails decode and safely restarts
    // from page 1 rather than producing a corrupted page.
    let cursor: { dueAt: Date; id: string } | undefined;
    if (query.cursor) {
      const sep = query.cursor.indexOf("_");
      if (sep > 0) {
        const ms = Number(query.cursor.slice(0, sep));
        const id = query.cursor.slice(sep + 1);
        if (Number.isFinite(ms) && id) cursor = { dueAt: new Date(ms), id };
      }
    }

    const rows = await this.repository.listScheduledFollowups({
      workspaceId: workspaceContext.workspaceId,
      status: query.status,
      restrictToGroupIds,
      limit: limit + 1,
      cursor,
    });

    const hasNext = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];

    return {
      items: items.map((f) => this.toFollowupDto(f)),
      page: { hasNext, nextCursor: hasNext && last ? `${last.dueAt.getTime()}_${last.id}` : null },
    };
  }

  async completeFollowup(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    id: string,
    body: CompleteFollowupRequest,
    correlationId: string | null,
  ): Promise<FollowupActionResponse> {
    const before = await this.loadFollowupInScope(authUser, workspaceContext, id, "followup.write");
    if (before.status !== "PENDING") {
      throw new FollowupInvalidStateException(undefined, { currentStatus: before.status });
    }
    const updated = await this.repository.completeScheduledFollowupWithVersion({ id, expectedVersion: body.version });
    if (!updated) {
      throw new VersionConflictException(undefined, { currentVersion: before.version });
    }
    await this.repository.insertAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      actorUserId: authUser.id,
      actorMembershipId: workspaceContext.membership.id,
      action: "scheduled_followup.completed",
      entityType: "scheduled_followup",
      entityId: updated.id,
      beforeJson: { status: before.status },
      afterJson: { status: updated.status },
      correlationId,
    });
    return { followUp: this.toFollowupDto(updated) };
  }

  async rescheduleFollowup(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    id: string,
    body: RescheduleFollowupRequest,
    correlationId: string | null,
  ): Promise<FollowupActionResponse> {
    const before = await this.loadFollowupInScope(authUser, workspaceContext, id, "followup.write");
    if (before.status !== "PENDING") {
      throw new FollowupInvalidStateException(undefined, { currentStatus: before.status });
    }
    const newDueAt = new Date(body.dueAt);
    if (Number.isNaN(newDueAt.getTime())) {
      throw new ValidationApiException({ dueAt: ["تاريخ/وقت غير صالح."] });
    }
    const updated = await this.repository.rescheduleScheduledFollowupWithVersion({ id, expectedVersion: body.version, newDueAt });
    if (!updated) {
      throw new VersionConflictException(undefined, { currentVersion: before.version });
    }
    await this.repository.insertAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      actorUserId: authUser.id,
      actorMembershipId: workspaceContext.membership.id,
      action: "scheduled_followup.rescheduled",
      entityType: "scheduled_followup",
      entityId: updated.id,
      beforeJson: { dueAt: before.dueAt.toISOString() },
      afterJson: { dueAt: updated.dueAt.toISOString() },
      correlationId,
    });
    return { followUp: this.toFollowupDto(updated) };
  }

  // ---------------------------------------------------------------------
  // WhatsApp Contact Draft / Contact Log
  // ---------------------------------------------------------------------

  async contactDraft(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    caseId: string,
    body: ContactDraftRequest,
  ): Promise<ContactDraftResponse> {
    const { attentionCase } = await this.loadCaseInScope(authUser, workspaceContext, caseId, "followup.read");

    if (!body.sessionId) {
      throw new ValidationApiException({ sessionId: ["مطلوب لبناء نص المسودة من سياق حصة فعلية."] });
    }
    const sessionGroupId = await this.repository.findGroupIdForSession(body.sessionId);
    if (!sessionGroupId) {
      throw new ResourceNotFoundException();
    }
    const inScope = await this.permissionResolver.isGroupInScope(
      workspaceContext.workspaceId,
      authUser.id,
      "parent_contact",
      sessionGroupId,
    );
    if (!inScope) {
      throw new ResourceNotFoundException();
    }

    const student = await this.repository.findStudentById(attentionCase.studentId);
    if (!student || student.workspaceId !== workspaceContext.workspaceId) {
      throw new ResourceNotFoundException();
    }

    const guardianLinks = await this.repository.listGuardiansForStudent(attentionCase.studentId);
    const link = guardianLinks.find((l) => l.guardian.id === body.guardianId);
    if (!link || !link.link.academicContactEnabled) {
      throw new GuardianContactDisabledException();
    }

    const sessionContext = await this.repository.findContactDraftSessionContext({
      sessionId: body.sessionId,
      studentId: attentionCase.studentId,
    });
    if (!sessionContext) {
      throw new ResourceNotFoundException();
    }

    const draft = this.buildWhatsAppDraft({
      teacherName: authUser.email?.split("@")[0] ?? "المعلم",
      studentName: student.name,
      subject: sessionContext.groupSubject ?? sessionContext.groupName,
      attendanceStatus: sessionContext.attendanceStatus,
      homeworkStatus: sessionContext.homeworkStatus,
      examStatus: sessionContext.examStatus,
      examScore: sessionContext.examScore,
      examMaxScore: sessionContext.examMaxScore,
    });

    const maskedPhone = this.maskPhone(link.guardian.normalizedPhone);
    const deepLink = this.buildWhatsAppDeepLink(link.guardian.normalizedPhone, draft);

    return {
      channel: "WHATSAPP_DEEPLINK",
      guardian: { id: link.guardian.id, maskedPhone },
      draft,
      deepLink,
    };
  }

  async createContactLog(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    body: CreateContactLogRequest,
  ): Promise<CreateContactLogResponse> {
    // parent_contact / followup.write is an OR gate (API Contract §9.7) —
    // no single `@RequirePermission` key can express it; PermissionGuard
    // still requires an active membership, this method does the OR check
    // manually, mirroring FinanceService's `resolveEitherPermissionScope`
    // convention for `/finance/collection-queue`.
    const student = await this.repository.findStudentById(body.studentId);
    if (!student || student.workspaceId !== workspaceContext.workspaceId) {
      throw new ResourceNotFoundException();
    }

    let groupIdForScope: string | undefined;
    if (body.sessionId) {
      groupIdForScope = await this.repository.findGroupIdForSession(body.sessionId);
    }
    const studentGroupIds = await this.repository.listGroupIdsForStudent(body.studentId);
    const candidateGroupIds = groupIdForScope ? [groupIdForScope] : studentGroupIds;

    const allowed = await this.isAnyGroupInEitherScope(
      workspaceContext.workspaceId,
      authUser.id,
      ["parent_contact", "followup.write"],
      candidateGroupIds,
    );
    if (!allowed) {
      throw new ResourceNotFoundException();
    }

    const guardianLinks = await this.repository.listGuardiansForStudent(body.studentId);
    const link = guardianLinks.find((l) => l.guardian.id === body.guardianId);
    if (!link || !link.link.academicContactEnabled) {
      throw new GuardianContactDisabledException();
    }

    if (body.outcome === "DEFERRED" && !body.followUpAt) {
      throw new ValidationApiException({ followUpAt: ["مطلوب عند outcome=DEFERRED."] });
    }
    if (body.outcome === "DEFERRED" && !body.attentionCaseId) {
      throw new ValidationApiException({ attentionCaseId: ["مطلوب عند outcome=DEFERRED لإنشاء متابعة مجدولة."] });
    }

    const { contactLog, scheduledFollowup } = await this.repository.insertContactLogTransaction({
      workspaceId: workspaceContext.workspaceId,
      studentId: body.studentId,
      guardianId: body.guardianId,
      attentionCaseId: body.attentionCaseId ?? null,
      sessionId: body.sessionId ?? null,
      channel: body.channel,
      draftSnapshot: body.draftSnapshot,
      outcome: body.outcome,
      notes: body.notes ?? null,
      followUpAt: body.followUpAt ? new Date(body.followUpAt) : null,
      actorUserId: authUser.id,
      actorMembershipId: workspaceContext.membership.id,
    });

    // ContactLog itself IS the audit trail for this action (API §10
    // Enforcement Matrix: "Parent contact ... Audit: ContactLog itself") —
    // no separate AuditEvent row.

    return {
      contactLog: this.toContactLogDto(contactLog),
      scheduledFollowUp: scheduledFollowup
        ? { id: scheduledFollowup.id, dueAt: scheduledFollowup.dueAt.toISOString(), status: scheduledFollowup.status }
        : null,
    };
  }

  // ---------------------------------------------------------------------
  // Scope helpers
  // ---------------------------------------------------------------------

  private async loadCaseInScope(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    caseId: string,
    permission: ScopedPermission,
  ): Promise<{ attentionCase: AttentionCaseRow; visibleReasons: AttentionReasonRow[] }> {
    const attentionCase = await this.repository.findAttentionCaseById(caseId);
    if (!attentionCase || attentionCase.workspaceId !== workspaceContext.workspaceId) {
      throw new ResourceNotFoundException();
    }
    const restrictToGroupIds = await this.resolveGroupScopeFilter(workspaceContext.workspaceId, authUser.id, permission);
    const reasons = await this.repository.listAttentionReasonsForCase(caseId);
    const visibleReasons = this.filterReasonsToScope(reasons, restrictToGroupIds);
    if (visibleReasons.length === 0) {
      // Safe no-leak: either the case genuinely has no reasons yet (should
      // not happen — a Case is only ever created alongside its first
      // Reason), or every one of its Reasons belongs to a group the caller
      // has no scope over. Either way, the case does not exist FOR THIS
      // CALLER.
      throw new ResourceNotFoundException();
    }
    return { attentionCase, visibleReasons };
  }

  private async loadFollowupInScope(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    followupId: string,
    permission: ScopedPermission,
  ) {
    const followup = await this.repository.findScheduledFollowupById(followupId);
    if (!followup || followup.workspaceId !== workspaceContext.workspaceId) {
      throw new ResourceNotFoundException();
    }
    // A follow-up is visible under the same rule as its Case.
    await this.loadCaseInScope(authUser, workspaceContext, followup.attentionCaseId, permission);
    return followup;
  }

  private filterReasonsToScope(reasons: AttentionReasonRow[], restrictToGroupIds: string[] | undefined): AttentionReasonRow[] {
    if (restrictToGroupIds === undefined) return reasons; // ALL_GROUPS/Owner
    const allowed = new Set(restrictToGroupIds);
    return reasons.filter((r) => allowed.has(r.groupId));
  }

  private async resolveGroupScopeFilter(
    workspaceId: string,
    authUserId: string,
    permission: ScopedPermission,
  ): Promise<string[] | undefined> {
    const grant = await this.permissionResolver.hasPermission(workspaceId, authUserId, permission);
    return this.scopeFilterFromGrant(grant);
  }

  /**
   * Phase 15C — the exact `undefined`/`[]`/`groupIds` mapping
   * `resolveGroupScopeFilter` produces, but from an already-resolved grant
   * (the one PermissionGuard stashed on `WorkspaceContext`). `undefined` ⇒
   * ALL_GROUPS/Owner (no restriction); `[]` ⇒ no grant, matches nothing
   * (defensive — the guard already required the permission workspace-wide).
   */
  private scopeFilterFromGrant(grant: EffectiveGrant | undefined): string[] | undefined {
    if (!grant) return [];
    if (grant.scope === "ALL_GROUPS") return undefined;
    return grant.groupIds ?? [];
  }

  /** True if ANY of `candidateGroupIds` is in scope for ANY of `permissions` (the "or" gate for `parent_contact/followup.write`). If `candidateGroupIds` is empty (no group context resolvable), falls back to "is either permission granted at all", matching the Collection Queue's own OR-gate convention. */
  private async isAnyGroupInEitherScope(
    workspaceId: string,
    authUserId: string,
    permissions: readonly ScopedPermission[],
    candidateGroupIds: string[],
  ): Promise<boolean> {
    const grants = await Promise.all(permissions.map((p) => this.permissionResolver.hasPermission(workspaceId, authUserId, p)));
    const granted = grants.filter((g): g is NonNullable<typeof g> => !!g);
    if (granted.length === 0) return false;
    if (granted.some((g) => g.scope === "ALL_GROUPS")) return true;
    if (candidateGroupIds.length === 0) return false;
    const union = new Set<string>();
    for (const g of granted) for (const id of g.groupIds ?? []) union.add(id);
    return candidateGroupIds.some((id) => union.has(id));
  }

  // ---------------------------------------------------------------------
  // WhatsApp draft/deeplink helpers
  // ---------------------------------------------------------------------

  private buildWhatsAppDraft(params: {
    teacherName: string;
    studentName: string;
    subject: string;
    attendanceStatus: string | null;
    homeworkStatus: string | null;
    examStatus: string;
    examScore: number | null;
    examMaxScore: number | null;
  }): string {
    const attendance = params.attendanceStatus ? (ATTENDANCE_LABELS[params.attendanceStatus] ?? params.attendanceStatus) : "غير مسجل";
    const homework = params.homeworkStatus ? (HOMEWORK_LABELS[params.homeworkStatus] ?? params.homeworkStatus) : "غير مسجل";
    let examClause: string;
    if (params.examStatus === "SCORED" && params.examScore !== null) {
      examClause = `والامتحان ${params.examScore}${params.examMaxScore !== null ? `/${params.examMaxScore}` : ""}`;
    } else if (params.examStatus === "ABSENT_FROM_EXAM") {
      examClause = "وتغيّب عن الامتحان";
    } else {
      examClause = "ولا يوجد امتحان اليوم";
    }
    return `السلام عليكم، مع حضرتك أ/ ${params.teacherName}. ملخص ${params.studentName} في حصة ${params.subject} اليوم: الحضور ${attendance}، الواجب ${homework}، ${examClause}. نرجو المتابعة. — قابلة للتعديل.`;
  }

  /** `wa.me/<E164 digits, no leading '+'>?text=<urlencoded>` — deliberate technical choice (§11.14 leaves the exact format unspecified: "generated-at-client-or-safe-server-value"). */
  private buildWhatsAppDeepLink(normalizedPhone: string, draft: string): string {
    const digitsOnly = normalizedPhone.replace(/[^0-9]/g, "");
    return `https://wa.me/${digitsOnly}?text=${encodeURIComponent(draft)}`;
  }

  private maskPhone(normalizedPhone: string): string {
    const digitsOnly = normalizedPhone.replace(/[^0-9]/g, "");
    const lastFour = digitsOnly.slice(-4);
    return `***${lastFour}`;
  }

  // ---------------------------------------------------------------------
  // DTO mappers
  // ---------------------------------------------------------------------

  private toCaseSummaryDto(row: AttentionCaseRow, visiblePriority: "MEDIUM" | "HIGH", studentName: string, studentCode: string): AttentionCaseSummary {
    return {
      id: row.id,
      studentId: row.studentId,
      studentName,
      studentCode,
      status: row.status as AttentionCaseSummary["status"],
      priority: visiblePriority,
      openedAt: row.openedAt.toISOString(),
      lastQualifiedAt: row.lastQualifiedAt.toISOString(),
    };
  }

  /**
   * Assembles the full `GET /attention-cases/{id}` (§11.13) shape from
   * ONLY the caller's visible Reasons — `priority` is the computed visible
   * priority (never the Case's own internal column), `reasons`/`evidence`
   * are the filtered subset, and `lastContact`/`nextFollowUp` are the
   * Case-level (not group-specific) summaries, safe to show to anyone with
   * ANY visibility into the Case (they reveal only "a contact/follow-up
   * happened/is due", never which group's evidence prompted it).
   */
  private async buildCaseDetailDto(row: AttentionCaseRow, visibleReasons: AttentionReasonRow[]): Promise<AttentionCase> {
    const priority = computeVisiblePriority(visibleReasons.map((r) => ({ severity: r.severity as "MEDIUM" | "HIGH" })));
    if (!priority) throw new ResourceNotFoundException(); // defensive — loadCaseInScope already guarantees this

    const student = await this.repository.findStudentById(row.studentId);
    if (!student) throw new ResourceNotFoundException();

    const evidence = await this.repository.listAttentionEvidenceForReasons(visibleReasons.map((r) => r.id));
    const evidenceByReason = new Map<string, typeof evidence>();
    for (const e of evidence) {
      const list = evidenceByReason.get(e.attentionReasonId) ?? [];
      list.push(e);
      evidenceByReason.set(e.attentionReasonId, list);
    }

    const lastContact = await this.repository.findMostRecentContactLogForCase(row.id);
    const nextFollowUp = await this.repository.findMostRecentPendingFollowupForCase(row.id);

    return {
      id: row.id,
      student: { id: student.id, name: student.name, studentCode: student.studentCode },
      status: row.status as AttentionCase["status"],
      priority,
      openedAt: row.openedAt.toISOString(),
      lastQualifiedAt: row.lastQualifiedAt.toISOString(),
      reasons: visibleReasons.map((r) => ({
        id: r.id,
        ruleKey: r.ruleKey,
        severity: r.severity as "MEDIUM" | "HIGH",
        groupId: r.groupId,
        firstDetectedAt: r.firstDetectedAt.toISOString(),
        lastDetectedAt: r.lastDetectedAt.toISOString(),
        evidence: (evidenceByReason.get(r.id) ?? []).map((e) => ({
          id: e.id,
          sourceType: e.sourceType as "SESSION_RECORD" | "SESSION",
          sourceId: e.sourceId,
          observedAt: e.observedAt.toISOString(),
          snapshot: e.evidenceSnapshot as Record<string, unknown>,
        })),
      })),
      lastContact: lastContact
        ? { id: lastContact.id, channel: lastContact.channel, outcome: lastContact.outcome, createdAt: lastContact.createdAt.toISOString() }
        : null,
      nextFollowUp: nextFollowUp ? { id: nextFollowUp.id, dueAt: nextFollowUp.dueAt.toISOString(), status: nextFollowUp.status } : null,
      version: row.version,
    };
  }

  private toFollowupDto(row: ScheduledFollowupRow) {
    return {
      id: row.id,
      attentionCaseId: row.attentionCaseId,
      studentId: row.studentId,
      dueAt: row.dueAt.toISOString(),
      status: row.status as "PENDING" | "DONE" | "CANCELLED",
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      version: row.version,
    };
  }

  private toContactLogDto(row: ContactLogRow) {
    return {
      id: row.id,
      studentId: row.studentId,
      guardianId: row.guardianId,
      attentionCaseId: row.attentionCaseId,
      sessionId: row.sessionId,
      channel: row.channel as "WHATSAPP_DEEPLINK" | "CALL" | "OTHER",
      draftSnapshot: row.draftSnapshot,
      outcome: row.outcome as "CONTACTED" | "NO_ANSWER" | "INVALID_NUMBER" | "DEFERRED",
      notes: row.notes,
      followUpAt: row.followUpAt ? row.followUpAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
