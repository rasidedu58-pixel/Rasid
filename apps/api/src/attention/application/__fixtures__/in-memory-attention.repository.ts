import { randomUUID } from "node:crypto";
import type {
  AttentionCaseRow,
  AttentionEvidenceRow,
  AttentionReasonRow,
  ContactDraftSessionContext,
  ContactLogRow,
  EnrollmentRow,
  GroupRow,
  GuardianRow,
  InsertContactLogInput,
  ScheduledFollowupRow,
  StudentGuardianRow,
  StudentGuardianWithGuardian,
  StudentRow,
} from "@academic-precision/database";
import type { AttentionRepositoryPort } from "../ports/attention-repository.port";

/**
 * In-memory test double for {@link AttentionRepositoryPort} — mirrors
 * `InMemoryFinanceRepository`/`InMemorySessionModeRepository` (Phase 5/6):
 * no live Postgres needed for unit tests. Does NOT simulate the rule
 * engine itself (that lives entirely in packages/database, DB-only, and is
 * covered by `rule-engine.test.ts` + the live integration suite) — this
 * fixture is seeded directly with whatever Cases/Reasons/Evidence a test
 * scenario needs, exactly like `InMemorySchedulingRepository` doesn't
 * simulate `generateSessionOccurrencesForRules`'s calendar math either.
 */
export class InMemoryAttentionRepository implements AttentionRepositoryPort {
  readonly casesById = new Map<string, AttentionCaseRow>();
  readonly reasonsById = new Map<string, AttentionReasonRow>();
  readonly evidenceById = new Map<string, AttentionEvidenceRow>();
  readonly contactLogsById = new Map<string, ContactLogRow>();
  readonly followupsById = new Map<string, ScheduledFollowupRow>();
  readonly studentsById = new Map<string, StudentRow>();
  readonly groupsById = new Map<string, GroupRow>();
  readonly enrollmentsById = new Map<string, EnrollmentRow>();
  readonly guardiansById = new Map<string, GuardianRow>();
  readonly studentGuardiansById = new Map<string, StudentGuardianRow>();
  readonly sessionGroupById = new Map<string, string>(); // sessionId -> groupId
  readonly contactDraftContextBySession = new Map<string, ContactDraftSessionContext>();
  readonly auditEvents: Array<{ action: string; entityId: string; [k: string]: unknown }> = [];

  private now(): Date {
    return new Date();
  }

  // ---- seeding helpers -----------------------------------------------

  seedStudent(input: Partial<StudentRow> & { workspaceId: string; name: string }): StudentRow {
    const now = this.now();
    const row: StudentRow = {
      id: input.id ?? randomUUID(),
      workspaceId: input.workspaceId,
      studentCode: input.studentCode ?? `AP-${randomUUID().slice(0, 6).toUpperCase()}`,
      name: input.name,
      searchNameNormalized: input.searchNameNormalized ?? input.name,
      status: input.status ?? "ACTIVE",
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      archivedAt: input.archivedAt ?? null,
      version: input.version ?? 1,
    };
    this.studentsById.set(row.id, row);
    return row;
  }

  seedGroup(input: Partial<GroupRow> & { workspaceId: string; name: string }): GroupRow {
    const now = this.now();
    const row: GroupRow = {
      id: input.id ?? randomUUID(),
      workspaceId: input.workspaceId,
      name: input.name,
      subject: input.subject ?? null,
      grade: input.grade ?? null,
      defaultLocationId: input.defaultLocationId ?? null,
      status: input.status ?? "ACTIVE",
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      archivedAt: input.archivedAt ?? null,
      version: input.version ?? 1,
    };
    this.groupsById.set(row.id, row);
    return row;
  }

  /** Links a Student to a Group for `listGroupIdsForStudent` purposes — a minimal Enrollment stand-in (fields beyond studentId/groupMonthId are not read by this fixture). */
  seedEnrollmentGroupLink(input: { workspaceId: string; studentId: string; groupId: string }): void {
    const now = this.now();
    const row: EnrollmentRow = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      studentId: input.studentId,
      // Reuse groupId directly as a stand-in groupMonthId key — this
      // fixture's own listGroupIdsForStudent below reads a parallel map
      // instead of joining through group_months, since GroupMonth isn't
      // modeled here at all (out of scope for Attention's own tests).
      groupMonthId: input.groupId,
      joinDate: "2026-08-01",
      status: "ACTIVE",
      feeMethod: "FULL_MONTH",
      customFeeMinor: null,
      endedAt: null,
      endReason: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    this.enrollmentsById.set(row.id, row);
  }

  seedGuardian(input: Partial<GuardianRow> & { workspaceId: string; phone: string }): GuardianRow {
    const now = this.now();
    const row: GuardianRow = {
      id: input.id ?? randomUUID(),
      workspaceId: input.workspaceId,
      name: input.name ?? null,
      phone: input.phone,
      normalizedPhone: input.normalizedPhone ?? input.phone.replace(/[^0-9]/g, ""),
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      archivedAt: input.archivedAt ?? null,
      version: input.version ?? 1,
    };
    this.guardiansById.set(row.id, row);
    return row;
  }

  seedStudentGuardian(
    input: Partial<StudentGuardianRow> & { workspaceId: string; studentId: string; guardianId: string },
  ): StudentGuardianRow {
    const now = this.now();
    const row: StudentGuardianRow = {
      id: input.id ?? randomUUID(),
      workspaceId: input.workspaceId,
      studentId: input.studentId,
      guardianId: input.guardianId,
      relationship: input.relationship ?? null,
      isPrimary: input.isPrimary ?? true,
      academicContactEnabled: input.academicContactEnabled ?? true,
      financialContactEnabled: input.financialContactEnabled ?? true,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    };
    this.studentGuardiansById.set(row.id, row);
    return row;
  }

  seedCase(input: Partial<AttentionCaseRow> & { workspaceId: string; studentId: string }): AttentionCaseRow {
    const now = this.now();
    const row: AttentionCaseRow = {
      id: input.id ?? randomUUID(),
      workspaceId: input.workspaceId,
      studentId: input.studentId,
      status: input.status ?? "NEW",
      priority: input.priority ?? "MEDIUM",
      openedAt: input.openedAt ?? now,
      lastQualifiedAt: input.lastQualifiedAt ?? now,
      contactedAt: input.contactedAt ?? null,
      monitoringSince: input.monitoringSince ?? null,
      closedAt: input.closedAt ?? null,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      version: input.version ?? 1,
    };
    this.casesById.set(row.id, row);
    return row;
  }

  seedReason(
    input: Partial<AttentionReasonRow> & { workspaceId: string; attentionCaseId: string; groupId: string; ruleKey: string },
  ): AttentionReasonRow {
    const now = this.now();
    const row: AttentionReasonRow = {
      id: input.id ?? randomUUID(),
      workspaceId: input.workspaceId,
      attentionCaseId: input.attentionCaseId,
      groupId: input.groupId,
      ruleKey: input.ruleKey,
      severity: input.severity ?? "MEDIUM",
      firstDetectedAt: input.firstDetectedAt ?? now,
      lastDetectedAt: input.lastDetectedAt ?? now,
      isActive: input.isActive ?? true,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    };
    this.reasonsById.set(row.id, row);
    return row;
  }

  seedEvidence(
    input: Partial<AttentionEvidenceRow> & { workspaceId: string; attentionReasonId: string },
  ): AttentionEvidenceRow {
    const now = this.now();
    const row: AttentionEvidenceRow = {
      id: input.id ?? randomUUID(),
      workspaceId: input.workspaceId,
      attentionReasonId: input.attentionReasonId,
      sourceType: input.sourceType ?? "SESSION_RECORD",
      sourceId: input.sourceId ?? randomUUID(),
      observedAt: input.observedAt ?? now,
      evidenceSnapshot: input.evidenceSnapshot ?? {},
      createdAt: input.createdAt ?? now,
    };
    this.evidenceById.set(row.id, row);
    return row;
  }

  seedFollowup(
    input: Partial<ScheduledFollowupRow> & { workspaceId: string; attentionCaseId: string; studentId: string },
  ): ScheduledFollowupRow {
    const now = this.now();
    const row: ScheduledFollowupRow = {
      id: input.id ?? randomUUID(),
      workspaceId: input.workspaceId,
      attentionCaseId: input.attentionCaseId,
      studentId: input.studentId,
      dueAt: input.dueAt ?? now,
      status: input.status ?? "PENDING",
      assigneeMembershipId: input.assigneeMembershipId ?? null,
      sourceContactLogId: input.sourceContactLogId ?? null,
      completedAt: input.completedAt ?? null,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      version: input.version ?? 1,
    };
    this.followupsById.set(row.id, row);
    return row;
  }

  seedSessionGroup(sessionId: string, groupId: string): void {
    this.sessionGroupById.set(sessionId, groupId);
  }

  seedContactDraftContext(sessionId: string, context: ContactDraftSessionContext): void {
    this.contactDraftContextBySession.set(sessionId, context);
  }

  // ---- AttentionRepositoryPort -----------------------------------------

  async findAttentionCaseById(id: string): Promise<AttentionCaseRow | undefined> {
    return this.casesById.get(id);
  }

  async listAttentionReasonsForCase(attentionCaseId: string): Promise<AttentionReasonRow[]> {
    return [...this.reasonsById.values()].filter((r) => r.attentionCaseId === attentionCaseId);
  }

  async listAttentionEvidenceForReasons(attentionReasonIds: string[]): Promise<AttentionEvidenceRow[]> {
    const set = new Set(attentionReasonIds);
    return [...this.evidenceById.values()].filter((e) => set.has(e.attentionReasonId));
  }

  async listGroupIdsForAttentionCase(attentionCaseId: string): Promise<string[]> {
    return [...new Set([...this.reasonsById.values()].filter((r) => r.attentionCaseId === attentionCaseId).map((r) => r.groupId))];
  }

  async listAttentionCasesForWorkspace(filter: {
    workspaceId: string;
    status?: string;
    restrictToGroupIds?: string[];
    limit: number;
    cursorId?: string;
  }): Promise<AttentionCaseRow[]> {
    let rows = [...this.casesById.values()].filter((c) => c.workspaceId === filter.workspaceId);
    if (filter.status) rows = rows.filter((c) => c.status === filter.status);
    if (filter.restrictToGroupIds !== undefined) {
      if (filter.restrictToGroupIds.length === 0) return [];
      const allowed = new Set(filter.restrictToGroupIds);
      rows = rows.filter((c) =>
        [...this.reasonsById.values()].some((r) => r.attentionCaseId === c.id && allowed.has(r.groupId)),
      );
    }
    rows.sort((a, b) => a.id.localeCompare(b.id));
    if (filter.cursorId) rows = rows.filter((c) => c.id > filter.cursorId!);
    return rows.slice(0, filter.limit);
  }

  async listStudentNamesByIds(workspaceId: string, studentIds: string[]): Promise<Array<{ id: string; name: string; studentCode: string }>> {
    const idSet = new Set(studentIds);
    return [...this.studentsById.values()]
      .filter((s) => s.workspaceId === workspaceId && idSet.has(s.id))
      .map((s) => ({ id: s.id, name: s.name, studentCode: s.studentCode }));
  }

  async updateAttentionCaseStatusWithVersion(input: {
    id: string;
    expectedVersion: number;
    newStatus: "IN_FOLLOWUP" | "CONTACTED" | "MONITORING" | "CLOSED";
  }): Promise<AttentionCaseRow | undefined> {
    const existing = this.casesById.get(input.id);
    if (!existing || existing.version !== input.expectedVersion) return undefined;
    const now = this.now();
    const patch: Partial<AttentionCaseRow> = { status: input.newStatus, updatedAt: now, version: existing.version + 1 };
    if (input.newStatus === "CONTACTED") patch.contactedAt = now;
    if (input.newStatus === "MONITORING") patch.monitoringSince = now;
    if (input.newStatus === "CLOSED") patch.closedAt = now;
    const updated = { ...existing, ...patch };
    this.casesById.set(existing.id, updated);
    return updated;
  }

  async findScheduledFollowupById(id: string): Promise<ScheduledFollowupRow | undefined> {
    return this.followupsById.get(id);
  }

  async listScheduledFollowups(filter: {
    workspaceId: string;
    status?: string;
    restrictToGroupIds?: string[];
    limit: number;
    cursor?: { dueAt: Date; id: string };
  }): Promise<ScheduledFollowupRow[]> {
    let rows = [...this.followupsById.values()].filter((f) => f.workspaceId === filter.workspaceId);
    if (filter.status) rows = rows.filter((f) => f.status === filter.status);
    if (filter.restrictToGroupIds !== undefined) {
      if (filter.restrictToGroupIds.length === 0) return [];
      const allowed = new Set(filter.restrictToGroupIds);
      rows = rows.filter((f) =>
        [...this.reasonsById.values()].some((r) => r.attentionCaseId === f.attentionCaseId && allowed.has(r.groupId)),
      );
    }
    // Phase 15 — mirrors the real repository's (due_at, id) row-value cursor.
    rows.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime() || a.id.localeCompare(b.id));
    if (filter.cursor) {
      const { dueAt, id } = filter.cursor;
      rows = rows.filter((f) => f.dueAt.getTime() > dueAt.getTime() || (f.dueAt.getTime() === dueAt.getTime() && f.id > id));
    }
    return rows.slice(0, filter.limit);
  }

  async completeScheduledFollowupWithVersion(input: { id: string; expectedVersion: number }): Promise<ScheduledFollowupRow | undefined> {
    const existing = this.followupsById.get(input.id);
    if (!existing || existing.version !== input.expectedVersion || existing.status !== "PENDING") return undefined;
    const now = this.now();
    const updated: ScheduledFollowupRow = { ...existing, status: "DONE", completedAt: now, updatedAt: now, version: existing.version + 1 };
    this.followupsById.set(existing.id, updated);
    return updated;
  }

  async rescheduleScheduledFollowupWithVersion(input: {
    id: string;
    expectedVersion: number;
    newDueAt: Date;
  }): Promise<ScheduledFollowupRow | undefined> {
    const existing = this.followupsById.get(input.id);
    if (!existing || existing.version !== input.expectedVersion || existing.status !== "PENDING") return undefined;
    const now = this.now();
    const updated: ScheduledFollowupRow = { ...existing, dueAt: input.newDueAt, updatedAt: now, version: existing.version + 1 };
    this.followupsById.set(existing.id, updated);
    return updated;
  }

  async insertContactLogTransaction(
    input: InsertContactLogInput,
  ): Promise<{ contactLog: ContactLogRow; scheduledFollowup: ScheduledFollowupRow | null }> {
    const now = this.now();
    const contactLog: ContactLogRow = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      studentId: input.studentId,
      guardianId: input.guardianId,
      attentionCaseId: input.attentionCaseId,
      sessionId: input.sessionId,
      channel: input.channel,
      draftSnapshot: input.draftSnapshot,
      outcome: input.outcome,
      notes: input.notes ?? null,
      followUpAt: input.followUpAt ?? null,
      actorUserId: input.actorUserId,
      actorMembershipId: input.actorMembershipId,
      createdAt: now,
    };
    this.contactLogsById.set(contactLog.id, contactLog);

    let scheduledFollowup: ScheduledFollowupRow | null = null;
    if (input.outcome === "DEFERRED") {
      if (!input.attentionCaseId || !input.followUpAt) {
        throw new Error("DEFERRED outcome requires both attentionCaseId and followUpAt.");
      }
      scheduledFollowup = this.seedFollowup({
        workspaceId: input.workspaceId,
        attentionCaseId: input.attentionCaseId,
        studentId: input.studentId,
        dueAt: input.followUpAt,
        status: "PENDING",
        sourceContactLogId: contactLog.id,
      });
    }

    return { contactLog, scheduledFollowup };
  }

  async findMostRecentContactLogForCase(attentionCaseId: string): Promise<ContactLogRow | undefined> {
    const rows = [...this.contactLogsById.values()]
      .filter((c) => c.attentionCaseId === attentionCaseId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return rows[0];
  }

  async findMostRecentPendingFollowupForCase(attentionCaseId: string): Promise<ScheduledFollowupRow | undefined> {
    const rows = [...this.followupsById.values()]
      .filter((f) => f.attentionCaseId === attentionCaseId && f.status === "PENDING")
      .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
    return rows[0];
  }

  async findGroupIdForSession(sessionId: string): Promise<string | undefined> {
    return this.sessionGroupById.get(sessionId);
  }

  async findContactDraftSessionContext(params: { sessionId: string; studentId: string }): Promise<ContactDraftSessionContext | undefined> {
    return this.contactDraftContextBySession.get(params.sessionId);
  }

  async findStudentById(id: string): Promise<StudentRow | undefined> {
    return this.studentsById.get(id);
  }

  async findEnrollmentById(id: string): Promise<EnrollmentRow | undefined> {
    return this.enrollmentsById.get(id);
  }

  async findGroupById(id: string): Promise<GroupRow | undefined> {
    return this.groupsById.get(id);
  }

  async listGroupIdsForStudent(studentId: string): Promise<string[]> {
    return [...new Set([...this.enrollmentsById.values()].filter((e) => e.studentId === studentId).map((e) => e.groupMonthId))];
  }

  async listGuardiansForStudent(studentId: string): Promise<StudentGuardianWithGuardian[]> {
    return [...this.studentGuardiansById.values()]
      .filter((link) => link.studentId === studentId)
      .map((link) => ({ link, guardian: this.guardiansById.get(link.guardianId)! }))
      .filter((x) => !!x.guardian);
  }

  async insertAuditEvent(input: {
    workspaceId: string;
    actorUserId: string | null;
    actorMembershipId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    beforeJson?: unknown;
    afterJson?: unknown;
    correlationId?: string | null;
  }): Promise<void> {
    this.auditEvents.push({ ...input, action: input.action, entityId: input.entityId });
  }
}
