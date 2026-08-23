import { randomUUID } from "node:crypto";
import type {
  AttendanceRecordInput,
  ExamNotDefinedResult,
  ExamScoreOutOfRangeResult,
  ExamScoreRecordInput,
  GroupMonthRow,
  GroupRow,
  HomeworkRecordInput,
  IdempotencyRecordRow,
  InvalidEnrollmentResult,
  InvalidStateResult,
  RosterEnrollmentRow,
  SessionExamRow,
  SessionModeAuditEventInput,
  SessionRecordRow,
  SessionRow,
  UpsertSessionExamInput,
} from "@academic-precision/database";
import { VERSION_CONFLICT } from "@academic-precision/database";
import type { SessionModeRepositoryPort } from "../ports/session-mode-repository.port";
import type { InMemoryStudentsRepository } from "../../../students/application/__fixtures__/in-memory-students.repository";

type BatchFailure = typeof VERSION_CONFLICT | InvalidStateResult | InvalidEnrollmentResult;

/**
 * In-memory test double for {@link SessionModeRepositoryPort} — mirrors
 * `InMemoryStudentsRepository`/`InMemoryTeamRepository`: no live Postgres
 * needed for unit tests, but preserves the same transactional/optimistic-
 * concurrency/cross-group-guard semantics as the real Drizzle repository.
 *
 * Wraps a shared {@link InMemoryStudentsRepository} instance for
 * groups/groupMonths/sessions/enrollments (reusing its seed helpers/maps
 * directly by reference — same pattern `EnrollmentsService`'s test suite
 * already uses to share one `InMemoryStudentsRepository` across two
 * services) rather than duplicating that seeding logic here.
 */
export class InMemorySessionModeRepository implements SessionModeRepositoryPort {
  readonly sessionRecordsById = new Map<string, SessionRecordRow>();
  readonly sessionExamsById = new Map<string, SessionExamRow>();
  readonly idempotencyById = new Map<string, IdempotencyRecordRow>();
  workspaceTimezone: string | undefined = "Africa/Cairo";

  constructor(private readonly shared: InMemoryStudentsRepository) {}

  private now(): Date {
    return new Date();
  }

  // ---- SessionModeRepositoryPort: reads delegating to the shared fixture ----

  async findWorkspaceTimezone(): Promise<string | undefined> {
    return this.workspaceTimezone;
  }

  async findGroupMonthById(id: string): Promise<GroupMonthRow | undefined> {
    return this.shared.groupMonthsById.get(id);
  }

  async findGroupById(id: string): Promise<GroupRow | undefined> {
    return this.shared.groupsById.get(id);
  }

  async findSessionById(id: string): Promise<SessionRow | undefined> {
    return this.shared.sessionsById.get(id);
  }

  async listEnrollmentsForRoster(groupMonthId: string): Promise<RosterEnrollmentRow[]> {
    const rows: RosterEnrollmentRow[] = [];
    for (const enrollment of this.shared.enrollmentsById.values()) {
      if (enrollment.groupMonthId !== groupMonthId) continue;
      const student = this.shared.studentsById.get(enrollment.studentId);
      if (!student) continue;
      rows.push({
        enrollmentId: enrollment.id,
        studentId: student.id,
        studentName: student.name,
        studentCode: student.studentCode,
        joinDate: enrollment.joinDate,
        endedAt: enrollment.endedAt,
      });
    }
    return rows;
  }

  async findSessionRecordsForSession(sessionId: string): Promise<SessionRecordRow[]> {
    return [...this.sessionRecordsById.values()].filter((r) => r.sessionId === sessionId);
  }

  async findSessionExamBySessionId(sessionId: string): Promise<SessionExamRow | undefined> {
    return [...this.sessionExamsById.values()].find((e) => e.sessionId === sessionId);
  }

  // ---- Start ----

  async startSessionTransaction(input: {
    sessionId: string;
    expectedVersion: number;
  }): Promise<SessionRow | typeof VERSION_CONFLICT | InvalidStateResult> {
    const current = this.shared.sessionsById.get(input.sessionId);
    if (!current) return VERSION_CONFLICT;
    if (current.status !== "SCHEDULED") return { kind: "INVALID_STATE", status: current.status };
    if (current.version !== input.expectedVersion) return VERSION_CONFLICT;
    const updated: SessionRow = {
      ...current,
      status: "IN_PROGRESS",
      startedAt: this.now(),
      version: current.version + 1,
      updatedAt: this.now(),
    };
    this.shared.sessionsById.set(current.id, updated);
    return updated;
  }

  // ---- Shared version-guard + roster-membership check (mirrors withSessionVersionGuard) ----

  private guardSession(params: {
    sessionId: string;
    groupMonthId: string;
    expectedVersion: number;
    enrollmentIds?: string[];
  }): SessionRow | BatchFailure {
    const current = this.shared.sessionsById.get(params.sessionId);
    if (!current || current.version !== params.expectedVersion) return VERSION_CONFLICT;
    if (current.status !== "IN_PROGRESS") return { kind: "INVALID_STATE", status: current.status };

    if (params.enrollmentIds && params.enrollmentIds.length > 0) {
      const uniqueIds = [...new Set(params.enrollmentIds)];
      const invalid = uniqueIds.filter((id) => {
        const enrollment = this.shared.enrollmentsById.get(id);
        return !enrollment || enrollment.groupMonthId !== params.groupMonthId;
      });
      if (invalid.length > 0) return { kind: "INVALID_ENROLLMENT", ids: invalid };
    }

    const bumped: SessionRow = { ...current, version: current.version + 1, updatedAt: this.now() };
    this.shared.sessionsById.set(current.id, bumped);
    return bumped;
  }

  private upsertRecordPatch(input: {
    workspaceId: string;
    groupMonthId: string;
    sessionId: string;
    enrollmentId: string;
    actorUserId: string;
    patch: Partial<{
      attendanceStatus: string | null;
      homeworkStatus: string | null;
      examStatus: string;
      examScore: number | null;
    }>;
  }): void {
    const existing = [...this.sessionRecordsById.values()].find(
      (r) => r.sessionId === input.sessionId && r.enrollmentId === input.enrollmentId,
    );
    if (existing) {
      const updated: SessionRecordRow = {
        ...existing,
        ...input.patch,
        examScore: input.patch.examScore !== undefined ? (input.patch.examScore as unknown as string | null) : existing.examScore,
        updatedBy: input.actorUserId,
        updatedAt: this.now(),
        version: existing.version + 1,
      } as SessionRecordRow;
      this.sessionRecordsById.set(existing.id, updated);
      return;
    }
    const now = this.now();
    const row: SessionRecordRow = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      groupMonthId: input.groupMonthId,
      sessionId: input.sessionId,
      enrollmentId: input.enrollmentId,
      attendanceStatus: input.patch.attendanceStatus ?? null,
      homeworkStatus: input.patch.homeworkStatus ?? null,
      examStatus: input.patch.examStatus ?? "NO_EXAM",
      examScore: (input.patch.examScore ?? null) as unknown as string | null,
      notes: null,
      createdBy: input.actorUserId,
      updatedBy: input.actorUserId,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    this.sessionRecordsById.set(row.id, row);
  }

  // ---- Attendance batch ----

  async applyAttendanceBatchTransaction(input: {
    sessionId: string;
    workspaceId: string;
    groupMonthId: string;
    expectedVersion: number;
    records: AttendanceRecordInput[];
    actorUserId: string;
  }): Promise<{ session: SessionRow } | BatchFailure> {
    const result = this.guardSession({
      sessionId: input.sessionId,
      groupMonthId: input.groupMonthId,
      expectedVersion: input.expectedVersion,
      enrollmentIds: input.records.map((r) => r.enrollmentId),
    });
    if (result === VERSION_CONFLICT || "kind" in result) return result;

    for (const record of input.records) {
      this.upsertRecordPatch({
        workspaceId: input.workspaceId,
        groupMonthId: input.groupMonthId,
        sessionId: input.sessionId,
        enrollmentId: record.enrollmentId,
        actorUserId: input.actorUserId,
        patch: { attendanceStatus: record.status },
      });
    }
    return { session: result };
  }

  // ---- Homework batch ----

  async applyHomeworkBatchTransaction(input: {
    sessionId: string;
    workspaceId: string;
    groupMonthId: string;
    expectedVersion: number;
    records: HomeworkRecordInput[];
    actorUserId: string;
  }): Promise<{ session: SessionRow } | BatchFailure> {
    const result = this.guardSession({
      sessionId: input.sessionId,
      groupMonthId: input.groupMonthId,
      expectedVersion: input.expectedVersion,
      enrollmentIds: input.records.map((r) => r.enrollmentId),
    });
    if (result === VERSION_CONFLICT || "kind" in result) return result;

    for (const record of input.records) {
      this.upsertRecordPatch({
        workspaceId: input.workspaceId,
        groupMonthId: input.groupMonthId,
        sessionId: input.sessionId,
        enrollmentId: record.enrollmentId,
        actorUserId: input.actorUserId,
        patch: { homeworkStatus: record.status },
      });
    }
    return { session: result };
  }

  // ---- Exam scores batch ----

  async applyExamScoresBatchTransaction(input: {
    sessionId: string;
    workspaceId: string;
    groupMonthId: string;
    expectedVersion: number;
    records: ExamScoreRecordInput[];
    actorUserId: string;
  }): Promise<{ session: SessionRow } | BatchFailure | ExamNotDefinedResult | ExamScoreOutOfRangeResult> {
    const result = this.guardSession({
      sessionId: input.sessionId,
      groupMonthId: input.groupMonthId,
      expectedVersion: input.expectedVersion,
      enrollmentIds: input.records.map((r) => r.enrollmentId),
    });
    if (result === VERSION_CONFLICT || "kind" in result) return result;

    const exam = [...this.sessionExamsById.values()].find((e) => e.sessionId === input.sessionId);
    if (!exam) return { kind: "EXAM_NOT_DEFINED" };
    const maxScore = Number(exam.maxScore);

    for (const record of input.records) {
      if (record.status === "SCORED") {
        if (record.score === undefined || record.score < 0 || record.score > maxScore) {
          return { kind: "EXAM_SCORE_OUT_OF_RANGE", enrollmentId: record.enrollmentId };
        }
      }
    }
    // Validated as a whole (no partial save) — now persist.
    for (const record of input.records) {
      this.upsertRecordPatch({
        workspaceId: input.workspaceId,
        groupMonthId: input.groupMonthId,
        sessionId: input.sessionId,
        enrollmentId: record.enrollmentId,
        actorUserId: input.actorUserId,
        patch:
          record.status === "SCORED"
            ? { examStatus: "SCORED", examScore: record.score! }
            : { examStatus: "ABSENT_FROM_EXAM", examScore: null },
      });
    }
    return { session: result };
  }

  // ---- Exam definition ----

  async upsertSessionExamTransaction(input: UpsertSessionExamInput): Promise<SessionExamRow | typeof VERSION_CONFLICT> {
    const existing = [...this.sessionExamsById.values()].find((e) => e.sessionId === input.sessionId);
    if (!existing) {
      const now = this.now();
      const row: SessionExamRow = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        name: input.name,
        maxScore: input.maxScore.toString(),
        lowScoreThreshold: input.lowScoreThreshold === null ? null : input.lowScoreThreshold.toString(),
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      this.sessionExamsById.set(row.id, row);
      return row;
    }
    if (input.expectedVersion === undefined || existing.version !== input.expectedVersion) {
      return VERSION_CONFLICT;
    }
    const updated: SessionExamRow = {
      ...existing,
      name: input.name,
      maxScore: input.maxScore.toString(),
      lowScoreThreshold: input.lowScoreThreshold === null ? null : input.lowScoreThreshold.toString(),
      updatedAt: this.now(),
      version: existing.version + 1,
    };
    this.sessionExamsById.set(existing.id, updated);
    return updated;
  }

  // ---- Complete ----

  async completeSessionTransaction(input: {
    sessionId: string;
    expectedVersion: number;
  }): Promise<SessionRow | typeof VERSION_CONFLICT | InvalidStateResult> {
    const current = this.shared.sessionsById.get(input.sessionId);
    if (!current) return VERSION_CONFLICT;
    if (current.status !== "IN_PROGRESS") return { kind: "INVALID_STATE", status: current.status };
    if (current.version !== input.expectedVersion) return VERSION_CONFLICT;
    const updated: SessionRow = {
      ...current,
      status: "COMPLETED",
      completedAt: this.now(),
      version: current.version + 1,
      updatedAt: this.now(),
    };
    this.shared.sessionsById.set(current.id, updated);
    return updated;
  }

  // ---- Idempotency (mirrors the real generic idempotency_records helpers) ----

  async findIdempotencyRecord(workspaceId: string, operation: string, key: string): Promise<IdempotencyRecordRow | undefined> {
    return [...this.idempotencyById.values()].find(
      (r) => r.workspaceId === workspaceId && r.operation === operation && r.key === key,
    );
  }

  async tryInsertIdempotencyRecord(input: {
    workspaceId: string;
    operation: string;
    key: string;
    requestHash: string;
    expiresAt: Date;
  }): Promise<IdempotencyRecordRow | undefined> {
    const existing = await this.findIdempotencyRecord(input.workspaceId, input.operation, input.key);
    if (existing) return undefined;
    const now = this.now();
    const row: IdempotencyRecordRow = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      operation: input.operation,
      key: input.key,
      requestHash: input.requestHash,
      status: "IN_PROGRESS",
      responseCode: null,
      responsePayload: null,
      createdAt: now,
      updatedAt: now,
      expiresAt: input.expiresAt,
    };
    this.idempotencyById.set(row.id, row);
    return row;
  }

  async completeIdempotencyRecord(id: string, responseCode: number, responsePayload: unknown): Promise<void> {
    const existing = this.idempotencyById.get(id);
    if (!existing) return;
    this.idempotencyById.set(id, { ...existing, status: "COMPLETED", responseCode, responsePayload, updatedAt: this.now() });
  }

  async failIdempotencyRecord(id: string): Promise<void> {
    const existing = this.idempotencyById.get(id);
    if (!existing) return;
    this.idempotencyById.set(id, { ...existing, status: "FAILED_RETRYABLE", updatedAt: this.now() });
  }

  // ---- Audit ----

  readonly auditEvents: SessionModeAuditEventInput[] = [];

  async insertAuditEvent(input: SessionModeAuditEventInput): Promise<void> {
    this.auditEvents.push(input);
  }
}
