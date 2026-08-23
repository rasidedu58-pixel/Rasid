import { randomUUID } from "node:crypto";
import type {
  CreateOrReactivateEnrollmentInput,
  EnrollmentRow,
  GroupMonthRow,
  GroupRow,
  GuardianRow,
  InsertGuardianInput,
  InsertStudentGuardianInput,
  InsertStudentInput,
  IssueQrInput,
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
  readonly auditEvents: StudentsAuditEventInput[] = [];
  workspaceTimezone = "Africa/Cairo";

  private now(): Date {
    return new Date();
  }

  // ---- seeding helpers -----------------------------------------------

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
    const now = this.now();
    const row: GroupMonthRow = {
      id: input.id ?? randomUUID(),
      workspaceId: input.workspaceId,
      groupId: input.groupId,
      operatingMonthId: input.operatingMonthId ?? randomUUID(),
      locationId: input.locationId ?? null,
      baseFeeMinor: input.baseFeeMinor ?? 60000,
      currencyCode: input.currencyCode ?? "EGP",
      duePolicy: input.duePolicy ?? "PER_GROUP",
      dueDay: input.dueDay ?? null,
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
    rows.sort((a, b) => a.id.localeCompare(b.id));
    if (filter.cursorId) rows = rows.filter((s) => s.id > filter.cursorId!);
    return rows.slice(0, filter.limit);
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

  async createOrReactivateEnrollmentTransaction(
    input: CreateOrReactivateEnrollmentInput,
  ): Promise<{ enrollment: EnrollmentRow; reactivated: boolean }> {
    const existing = [...this.enrollmentsById.values()].find(
      (e) => e.studentId === input.studentId && e.groupMonthId === input.groupMonthId,
    );
    const now = this.now();
    if (existing) {
      const updated: EnrollmentRow = {
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
      this.enrollmentsById.set(existing.id, updated);
      return { enrollment: updated, reactivated: true };
    }
    const row: EnrollmentRow = {
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
    this.enrollmentsById.set(row.id, row);
    return { enrollment: row, reactivated: false };
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
  ): Promise<{ source: EnrollmentRow; target: EnrollmentRow; reactivated: boolean } | undefined> {
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

    return { source: updatedSource, target, reactivated };
  }

  async insertAuditEvent(input: StudentsAuditEventInput): Promise<void> {
    this.auditEvents.push(input);
  }
}
