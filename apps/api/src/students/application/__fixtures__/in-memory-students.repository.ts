import { randomUUID } from "node:crypto";
import type {
  CreateOrReactivateEnrollmentInput,
  EnrollmentHistoryRow,
  EnrollmentRow,
  FinancialObligationRow,
  GroupMonthRow,
  GroupRow,
  GuardianRow,
  InsertGuardianInput,
  InsertStudentGuardianInput,
  InsertStudentInput,
  IssueQrInput,
  ObligationTerms,
  OperatingMonthRow,
  QrCredentialRow,
  ReissueQrInput,
  SessionRow,
  StudentGuardianRow,
  StudentGuardianWithGuardian,
  StudentRow,
  StudentsAuditEventInput,
  StudentSearchFilter,
  TransferEnrollmentTransactionInput,
  UpdateStudentGuardianInput,
  UpdateStudentInput,
  WithdrawEnrollmentInput,
  WorkspaceRow,
} from "@academic-precision/database";
import type { StudentsRepositoryPort } from "../ports/students-repository.port";

/**
 * In-memory test double for {@link StudentsRepositoryPort} — mirrors
 * `InMemorySchedulingRepository` (Phase 3): no live Postgres needed for
 * unit tests, but preserves the same transactional/optimistic-concurrency/
 * INT-03/INT-04/INT-08 semantics as the real Drizzle repository.
 */
export class InMemoryStudentsRepository implements StudentsRepositoryPort {
  readonly studentsById = new Map<string, StudentRow>();
  readonly guardiansById = new Map<string, GuardianRow>();
  readonly studentGuardiansById = new Map<string, StudentGuardianRow>();
  readonly qrById = new Map<string, QrCredentialRow>();
  readonly enrollmentsById = new Map<string, EnrollmentRow>();
  readonly groupsById = new Map<string, GroupRow>();
  readonly groupMonthsById = new Map<string, GroupMonthRow>();
  readonly sessionsById = new Map<string, SessionRow>();
  readonly workspacesById = new Map<string, WorkspaceRow>();
  readonly operatingMonthsById = new Map<string, OperatingMonthRow>();
  readonly obligationsById = new Map<string, FinancialObligationRow>();
  readonly auditEvents: StudentsAuditEventInput[] = [];
  workspaceTimezone = "Africa/Cairo";

  private now(): Date {
    return new Date();
  }

  // ---- seeding helpers -----------------------------------------------

  /** Phase 6 — auto-seeded by `seedGroupMonth` when not already present, so pre-Phase-6 tests never need to know about it. */
  seedWorkspace(input: Partial<WorkspaceRow> & { id: string }): WorkspaceRow {
    const now = this.now();
    const row: WorkspaceRow = {
      id: input.id,
      ownerUserId: input.ownerUserId ?? "u-owner",
      name: input.name ?? "Workspace",
      workspaceType: input.workspaceType ?? "TEACHER",
      locale: input.locale ?? "ar-EG",
      timezone: input.timezone ?? this.workspaceTimezone,
      dueDatePolicy: input.dueDatePolicy ?? "PER_GROUP",
      unifiedDueDay: input.unifiedDueDay ?? null,
      status: input.status ?? "ACTIVE",
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      archivedAt: input.archivedAt ?? null,
    };
    this.workspacesById.set(row.id, row);
    return row;
  }

  private ensureWorkspace(workspaceId: string): WorkspaceRow {
    return this.workspacesById.get(workspaceId) ?? this.seedWorkspace({ id: workspaceId });
  }

  /** Phase 6 — auto-seeded by `seedGroupMonth` (year 2026/month 8 default) when not already present. */
  seedOperatingMonth(input: Partial<OperatingMonthRow> & { workspaceId: string }): OperatingMonthRow {
    const now = this.now();
    const row: OperatingMonthRow = {
      id: input.id ?? randomUUID(),
      workspaceId: input.workspaceId,
      year: input.year ?? 2026,
      month: input.month ?? 8,
      status: input.status ?? "CURRENT",
      createdByUserId: input.createdByUserId ?? "u-owner",
      createdAt: input.createdAt ?? now,
      activatedAt: input.activatedAt ?? null,
      archivedAt: input.archivedAt ?? null,
      version: input.version ?? 1,
    };
    this.operatingMonthsById.set(row.id, row);
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

  seedGroupMonth(
    input: Partial<GroupMonthRow> & { workspaceId: string; groupId: string; operatingMonthId?: string },
  ): GroupMonthRow {
    // Phase 6: obligation due_date resolution needs a real workspace + a
    // real operating month with year/month — auto-seed both with sensible
    // defaults so every pre-Phase-6 test (which only ever passed
    // workspaceId/groupId) keeps working unchanged.
    this.ensureWorkspace(input.workspaceId);
    const operatingMonthId = input.operatingMonthId ?? this.seedOperatingMonth({ workspaceId: input.workspaceId }).id;

    const now = this.now();
    const row: GroupMonthRow = {
      id: input.id ?? randomUUID(),
      workspaceId: input.workspaceId,
      groupId: input.groupId,
      operatingMonthId,
      locationId: input.locationId ?? null,
      baseFeeMinor: input.baseFeeMinor ?? 60000,
      currencyCode: input.currencyCode ?? "EGP",
      duePolicy: input.duePolicy ?? "PER_GROUP",
      dueDay: input.dueDay ?? 15,
      joinFeePolicy: input.joinFeePolicy ?? "ASK_EVERY_TIME",
      monthlyStatus: input.monthlyStatus ?? "ACTIVE",
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      version: input.version ?? 1,
    };
    this.groupMonthsById.set(row.id, row);
    return row;
  }

  seedSession(input: Partial<SessionRow> & { workspaceId: string; groupMonthId: string; createdByUserId: string }): SessionRow {
    const now = this.now();
    const row: SessionRow = {
      id: input.id ?? randomUUID(),
      workspaceId: input.workspaceId,
      groupMonthId: input.groupMonthId,
      scheduledAt: input.scheduledAt ?? now,
      durationMinutes: input.durationMinutes ?? 60,
      status: input.status ?? "SCHEDULED",
      origin: input.origin ?? "GENERATED",
      rescheduledFromSessionId: input.rescheduledFromSessionId ?? null,
      billableForProration: input.billableForProration ?? true,
      startedAt: input.startedAt ?? null,
      completedAt: input.completedAt ?? null,
      cancelledAt: input.cancelledAt ?? null,
      createdByUserId: input.createdByUserId,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      version: input.version ?? 1,
    };
    this.sessionsById.set(row.id, row);
    return row;
  }

  seedStudent(input: Partial<StudentRow> & { workspaceId: string; studentCode: string; name: string }): StudentRow {
    const now = this.now();
    const row: StudentRow = {
      id: input.id ?? randomUUID(),
      workspaceId: input.workspaceId,
      studentCode: input.studentCode,
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

  /** Phase 6 — direct obligation seeding for Finance tests that don't need a full Enrollment flow. */
  seedObligation(
    input: Partial<FinancialObligationRow> & { workspaceId: string; enrollmentId: string; netDueMinor: number },
  ): FinancialObligationRow {
    const now = this.now();
    const row: FinancialObligationRow = {
      id: input.id ?? randomUUID(),
      workspaceId: input.workspaceId,
      enrollmentId: input.enrollmentId,
      currencyCode: input.currencyCode ?? "EGP",
      baseFeeMinor: input.baseFeeMinor ?? input.netDueMinor,
      discountMinor: input.discountMinor ?? 0,
      waiverMinor: input.waiverMinor ?? 0,
      netDueMinor: input.netDueMinor,
      dueDate: input.dueDate ?? "2026-08-15",
      amountPaidMinor: input.amountPaidMinor ?? 0,
      remainingMinor: input.remainingMinor ?? input.netDueMinor - (input.amountPaidMinor ?? 0),
      status: input.status ?? "UNPAID",
      calculationBasis: input.calculationBasis ?? "FULL_MONTH",
      calculationSnapshotJson: input.calculationSnapshotJson ?? null,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      version: input.version ?? 1,
    };
    this.obligationsById.set(row.id, row);
    return row;
  }

  seedGuardian(input: Partial<GuardianRow> & { workspaceId: string; phone: string; normalizedPhone: string }): GuardianRow {
    const now = this.now();
    const row: GuardianRow = {
      id: input.id ?? randomUUID(),
      workspaceId: input.workspaceId,
      name: input.name ?? null,
      phone: input.phone,
      normalizedPhone: input.normalizedPhone,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      archivedAt: input.archivedAt ?? null,
      version: input.version ?? 1,
    };
    this.guardiansById.set(row.id, row);
    return row;
  }

  // ---- StudentsRepositoryPort ------------------------------------------

  async findWorkspaceTimezone(): Promise<string | undefined> {
    return this.workspaceTimezone;
  }

  async findWorkspaceById(id: string): Promise<WorkspaceRow | undefined> {
    return this.workspacesById.get(id);
  }

  async findOperatingMonthById(id: string): Promise<OperatingMonthRow | undefined> {
    return this.operatingMonthsById.get(id);
  }

  async findObligationByEnrollmentId(enrollmentId: string): Promise<FinancialObligationRow | undefined> {
    return [...this.obligationsById.values()].find((o) => o.enrollmentId === enrollmentId);
  }

  async findGroupMonthById(id: string): Promise<GroupMonthRow | undefined> {
    return this.groupMonthsById.get(id);
  }

  async findGroupById(id: string): Promise<GroupRow | undefined> {
    return this.groupsById.get(id);
  }

  async listSessionsForGroupMonth(groupMonthId: string): Promise<SessionRow[]> {
    return [...this.sessionsById.values()].filter((s) => s.groupMonthId === groupMonthId);
  }

  async generateUniqueStudentCode(): Promise<string> {
    return `AP-${randomUUID().slice(0, 6).toUpperCase()}`;
  }

  async findStudentById(id: string): Promise<StudentRow | undefined> {
    return this.studentsById.get(id);
  }

  async insertStudent(input: InsertStudentInput): Promise<StudentRow> {
    return this.seedStudent(input);
  }

  async updateStudentWithVersion(
    id: string,
    expectedVersion: number,
    patch: UpdateStudentInput,
  ): Promise<StudentRow | undefined> {
    const existing = this.studentsById.get(id);
    if (!existing || existing.version !== expectedVersion) return undefined;
    const updated: StudentRow = { ...existing, ...patch, updatedAt: this.now(), version: expectedVersion + 1 };
    this.studentsById.set(id, updated);
    return updated;
  }

  async searchStudents(filter: StudentSearchFilter): Promise<StudentRow[]> {
    let rows = [...this.studentsById.values()].filter((s) => s.workspaceId === filter.workspaceId);
    if (filter.studentCode) {
      rows = rows.filter((s) => s.studentCode === filter.studentCode);
    } else if (filter.guardianNormalizedPhone) {
      const guardianIds = new Set(
        [...this.guardiansById.values()]
          .filter((g) => g.normalizedPhone === filter.guardianNormalizedPhone)
          .map((g) => g.id),
      );
      const studentIds = new Set(
        [...this.studentGuardiansById.values()]
          .filter((sg) => guardianIds.has(sg.guardianId))
          .map((sg) => sg.studentId),
      );
      rows = rows.filter((s) => studentIds.has(s.id));
    } else if (filter.normalizedNameQuery) {
      rows = rows.filter((s) => s.searchNameNormalized.includes(filter.normalizedNameQuery!));
    }
    if (filter.restrictToGroupIds !== undefined) {
      const allowed = new Set(filter.restrictToGroupIds);
      const inScope = new Set<string>();
      for (const enrollment of this.enrollmentsById.values()) {
        const groupMonth = this.groupMonthsById.get(enrollment.groupMonthId);
        if (groupMonth && allowed.has(groupMonth.groupId)) inScope.add(enrollment.studentId);
      }
      rows = rows.filter((s) => inScope.has(s.id));
    }
    rows.sort((a, b) => a.id.localeCompare(b.id));
    if (filter.cursorId) rows = rows.filter((s) => s.id > filter.cursorId!);
    return rows.slice(0, filter.limit);
  }

  async listGroupIdsForStudent(studentId: string): Promise<string[]> {
    const groupIds = new Set<string>();
    for (const enrollment of this.enrollmentsById.values()) {
      if (enrollment.studentId !== studentId) continue;
      const groupMonth = this.groupMonthsById.get(enrollment.groupMonthId);
      if (groupMonth) groupIds.add(groupMonth.groupId);
    }
    return [...groupIds];
  }

  async listEnrollmentsForStudent(studentId: string): Promise<EnrollmentHistoryRow[]> {
    const out: EnrollmentHistoryRow[] = [];
    for (const enrollment of this.enrollmentsById.values()) {
      if (enrollment.studentId !== studentId) continue;
      const groupMonth = this.groupMonthsById.get(enrollment.groupMonthId);
      if (!groupMonth) continue;
      const group = this.groupsById.get(groupMonth.groupId);
      const month = this.operatingMonthsById.get(groupMonth.operatingMonthId);
      if (!group || !month) continue;
      out.push({ enrollment, groupId: group.id, groupName: group.name, year: month.year, month: month.month });
    }
    return out.sort(
      (a, b) =>
        b.year - a.year ||
        b.month - a.month ||
        (b.enrollment.createdAt?.getTime() ?? 0) - (a.enrollment.createdAt?.getTime() ?? 0),
    );
  }

  async insertGuardian(input: InsertGuardianInput): Promise<GuardianRow> {
    return this.seedGuardian(input);
  }

  async findGuardianById(id: string): Promise<GuardianRow | undefined> {
    return this.guardiansById.get(id);
  }

  async insertStudentGuardian(input: InsertStudentGuardianInput): Promise<StudentGuardianRow> {
    const now = this.now();
    const row: StudentGuardianRow = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      studentId: input.studentId,
      guardianId: input.guardianId,
      relationship: input.relationship ?? null,
      isPrimary: input.isPrimary,
      academicContactEnabled: input.academicContactEnabled,
      financialContactEnabled: input.financialContactEnabled,
      createdAt: now,
      updatedAt: now,
    };
    this.studentGuardiansById.set(row.id, row);
    return row;
  }

  async findStudentGuardianById(id: string): Promise<StudentGuardianRow | undefined> {
    return this.studentGuardiansById.get(id);
  }

  async listGuardiansForStudent(studentId: string): Promise<StudentGuardianWithGuardian[]> {
    return [...this.studentGuardiansById.values()]
      .filter((sg) => sg.studentId === studentId)
      .map((link) => {
        const guardian = this.guardiansById.get(link.guardianId);
        if (!guardian) throw new Error("Inconsistent fixture: guardian not found for student_guardians row.");
        return { link, guardian };
      });
  }

  async updateStudentGuardian(id: string, patch: UpdateStudentGuardianInput): Promise<StudentGuardianRow | undefined> {
    const existing = this.studentGuardiansById.get(id);
    if (!existing) return undefined;
    const updated: StudentGuardianRow = { ...existing, ...patch, updatedAt: this.now() };
    this.studentGuardiansById.set(id, updated);
    return updated;
  }

  async setPrimaryGuardianTransaction(
    studentId: string,
    guardianLinkId: string,
  ): Promise<StudentGuardianRow | undefined> {
    for (const [id, link] of this.studentGuardiansById.entries()) {
      if (link.studentId === studentId && link.isPrimary) {
        this.studentGuardiansById.set(id, { ...link, isPrimary: false, updatedAt: this.now() });
      }
    }
    const target = this.studentGuardiansById.get(guardianLinkId);
    if (!target || target.studentId !== studentId) return undefined;
    const updated: StudentGuardianRow = { ...target, isPrimary: true, updatedAt: this.now() };
    this.studentGuardiansById.set(guardianLinkId, updated);
    return updated;
  }

  async findActiveQrForStudent(studentId: string): Promise<QrCredentialRow | undefined> {
    return [...this.qrById.values()].find((q) => q.studentId === studentId && q.status === "ACTIVE");
  }

  async findQrByTokenHash(tokenHash: string): Promise<QrCredentialRow | undefined> {
    return [...this.qrById.values()].find((q) => q.tokenHash === tokenHash && q.status === "ACTIVE");
  }

  async issueQrCredential(input: IssueQrInput): Promise<QrCredentialRow> {
    const now = this.now();
    const row: QrCredentialRow = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      studentId: input.studentId,
      tokenHash: input.tokenHash,
      status: "ACTIVE",
      issuedAt: now,
      revokedAt: null,
      revokeReason: null,
      issuedByUserId: input.issuedByUserId,
      revokedByUserId: null,
      createdAt: now,
    };
    this.qrById.set(row.id, row);
    return row;
  }

  async reissueQrCredentialTransaction(
    input: ReissueQrInput,
  ): Promise<{ revoked: QrCredentialRow | null; issued: QrCredentialRow }> {
    const active = [...this.qrById.values()].find((q) => q.studentId === input.studentId && q.status === "ACTIVE");
    let revoked: QrCredentialRow | null = null;
    if (active) {
      const now = this.now();
      revoked = {
        ...active,
        status: "REVOKED",
        revokedAt: now,
        revokeReason: input.revokeReason ?? "REISSUED",
        revokedByUserId: input.revokedByUserId,
      };
      this.qrById.set(active.id, revoked);
    }
    const issued = await this.issueQrCredential({
      workspaceId: input.workspaceId,
      studentId: input.studentId,
      tokenHash: input.newTokenHash,
      issuedByUserId: input.issuedByUserId,
    });
    return { revoked, issued };
  }

  async findEnrollmentById(id: string): Promise<EnrollmentRow | undefined> {
    return this.enrollmentsById.get(id);
  }

  async findEnrollmentByStudentAndGroupMonth(
    studentId: string,
    groupMonthId: string,
  ): Promise<EnrollmentRow | undefined> {
    return [...this.enrollmentsById.values()].find(
      (e) => e.studentId === studentId && e.groupMonthId === groupMonthId,
    );
  }

  /** Mirrors `upsertObligationForEnrollment` (packages/database) exactly — create, refresh-if-untouched, or leave-alone-if-real-ledger-activity. */
  private upsertObligation(workspaceId: string, enrollmentId: string, terms: ObligationTerms): FinancialObligationRow {
    const existing = [...this.obligationsById.values()].find((o) => o.enrollmentId === enrollmentId);
    const now = this.now();
    if (!existing) {
      const row: FinancialObligationRow = {
        id: randomUUID(),
        workspaceId,
        enrollmentId,
        currencyCode: terms.currencyCode,
        baseFeeMinor: terms.baseFeeMinor,
        discountMinor: 0,
        waiverMinor: 0,
        netDueMinor: terms.baseFeeMinor,
        dueDate: terms.dueDate,
        amountPaidMinor: 0,
        remainingMinor: terms.baseFeeMinor,
        status: "UNPAID",
        calculationBasis: terms.calculationBasis,
        calculationSnapshotJson: terms.calculationSnapshotJson,
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      this.obligationsById.set(row.id, row);
      return row;
    }
    if (existing.status !== "UNPAID" || existing.amountPaidMinor !== 0) {
      return existing; // real ledger activity — never silently touched
    }
    const updated: FinancialObligationRow = {
      ...existing,
      currencyCode: terms.currencyCode,
      baseFeeMinor: terms.baseFeeMinor,
      netDueMinor: terms.baseFeeMinor,
      dueDate: terms.dueDate,
      remainingMinor: terms.baseFeeMinor,
      calculationBasis: terms.calculationBasis,
      calculationSnapshotJson: terms.calculationSnapshotJson,
      updatedAt: now,
      version: existing.version + 1,
    };
    this.obligationsById.set(existing.id, updated);
    return updated;
  }

  async createOrReactivateEnrollmentTransaction(
    input: CreateOrReactivateEnrollmentInput,
  ): Promise<{ enrollment: EnrollmentRow; reactivated: boolean; obligation: FinancialObligationRow }> {
    const existing = [...this.enrollmentsById.values()].find(
      (e) => e.studentId === input.studentId && e.groupMonthId === input.groupMonthId,
    );
    const now = this.now();
    let enrollment: EnrollmentRow;
    let reactivated: boolean;
    if (existing) {
      enrollment = {
        ...existing,
        joinDate: input.joinDate,
        status: input.status,
        feeMethod: input.feeMethod,
        customFeeMinor: input.customFeeMinor ?? null,
        endedAt: null,
        endReason: null,
        updatedAt: now,
        version: existing.version + 1,
      };
      this.enrollmentsById.set(existing.id, enrollment);
      reactivated = true;
    } else {
      enrollment = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        studentId: input.studentId,
        groupMonthId: input.groupMonthId,
        joinDate: input.joinDate,
        status: input.status,
        feeMethod: input.feeMethod,
        customFeeMinor: input.customFeeMinor ?? null,
        endedAt: null,
        endReason: null,
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      this.enrollmentsById.set(enrollment.id, enrollment);
      reactivated = false;
    }

    const obligation = this.upsertObligation(input.workspaceId, enrollment.id, input.obligation);
    return { enrollment, reactivated, obligation };
  }

  async withdrawEnrollment(input: WithdrawEnrollmentInput): Promise<EnrollmentRow | undefined> {
    const existing = this.enrollmentsById.get(input.id);
    if (!existing || existing.endedAt) return undefined;
    const updated: EnrollmentRow = {
      ...existing,
      status: "WITHDRAWN",
      endedAt: input.effectiveDate ?? this.now(),
      endReason: input.reason ?? null,
      updatedAt: this.now(),
      version: existing.version + 1,
    };
    this.enrollmentsById.set(input.id, updated);
    return updated;
  }

  async transferEnrollmentTransaction(
    input: TransferEnrollmentTransactionInput,
  ): Promise<
    { source: EnrollmentRow; target: EnrollmentRow; reactivated: boolean; obligation: FinancialObligationRow } | undefined
  > {
    const source = this.enrollmentsById.get(input.sourceEnrollmentId);
    if (!source) return undefined;
    const now = this.now();
    const updatedSource: EnrollmentRow = {
      ...source,
      status: "TRANSFERRED",
      endedAt: now,
      endReason: "TRANSFER",
      updatedAt: now,
      version: source.version + 1,
    };
    this.enrollmentsById.set(source.id, updatedSource);

    const existingTarget = [...this.enrollmentsById.values()].find(
      (e) => e.studentId === source.studentId && e.groupMonthId === input.targetGroupMonthId,
    );
    let target: EnrollmentRow;
    let reactivated = false;
    if (existingTarget) {
      target = {
        ...existingTarget,
        joinDate: input.joinDate,
        status: input.status,
        feeMethod: input.feeMethod,
        customFeeMinor: input.customFeeMinor ?? null,
        endedAt: null,
        endReason: null,
        updatedAt: now,
        version: existingTarget.version + 1,
      };
      reactivated = true;
    } else {
      target = {
        id: randomUUID(),
        workspaceId: input.targetWorkspaceId,
        studentId: source.studentId,
        groupMonthId: input.targetGroupMonthId,
        joinDate: input.joinDate,
        status: input.status,
        feeMethod: input.feeMethod,
        customFeeMinor: input.customFeeMinor ?? null,
        endedAt: null,
        endReason: null,
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
    }
    this.enrollmentsById.set(target.id, target);

    const obligation = this.upsertObligation(input.targetWorkspaceId, target.id, input.obligation);
    return { source: updatedSource, target, reactivated, obligation };
  }

  async insertAuditEvent(input: StudentsAuditEventInput): Promise<void> {
    this.auditEvents.push(input);
  }
}
