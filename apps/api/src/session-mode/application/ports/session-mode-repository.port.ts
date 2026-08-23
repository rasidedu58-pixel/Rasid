import type {
  AttendanceRecordInput,
  ExamScoreRecordInput,
  ExamScoreOutOfRangeResult,
  ExamNotDefinedResult,
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
  VERSION_CONFLICT,
} from "@academic-precision/database";

type BatchFailure = typeof VERSION_CONFLICT | InvalidStateResult | InvalidEnrollmentResult;

/**
 * Port (dependency-inversion boundary) between the Session Mode application
 * layer and its persistence — mirrors the Phase 1-4
 * `TeamRepositoryPort`/`SchedulingRepositoryPort`/`StudentsRepositoryPort`
 * convention exactly. `DrizzleSessionModeRepository` is the real
 * implementation; tests supply an in-memory fake.
 */
export interface SessionModeRepositoryPort {
  findWorkspaceTimezone(workspaceId: string): Promise<string | undefined>;
  findGroupMonthById(id: string): Promise<GroupMonthRow | undefined>;
  findGroupById(id: string): Promise<GroupRow | undefined>;
  findSessionById(id: string): Promise<SessionRow | undefined>;

  listEnrollmentsForRoster(groupMonthId: string): Promise<RosterEnrollmentRow[]>;
  findSessionRecordsForSession(sessionId: string): Promise<SessionRecordRow[]>;
  findSessionExamBySessionId(sessionId: string): Promise<SessionExamRow | undefined>;

  startSessionTransaction(input: {
    sessionId: string;
    expectedVersion: number;
  }): Promise<SessionRow | typeof VERSION_CONFLICT | InvalidStateResult>;

  applyAttendanceBatchTransaction(input: {
    sessionId: string;
    workspaceId: string;
    groupMonthId: string;
    expectedVersion: number;
    records: AttendanceRecordInput[];
    actorUserId: string;
  }): Promise<{ session: SessionRow } | BatchFailure>;

  applyHomeworkBatchTransaction(input: {
    sessionId: string;
    workspaceId: string;
    groupMonthId: string;
    expectedVersion: number;
    records: HomeworkRecordInput[];
    actorUserId: string;
  }): Promise<{ session: SessionRow } | BatchFailure>;

  applyExamScoresBatchTransaction(input: {
    sessionId: string;
    workspaceId: string;
    groupMonthId: string;
    expectedVersion: number;
    records: ExamScoreRecordInput[];
    actorUserId: string;
  }): Promise<{ session: SessionRow } | BatchFailure | ExamNotDefinedResult | ExamScoreOutOfRangeResult>;

  upsertSessionExamTransaction(input: UpsertSessionExamInput): Promise<SessionExamRow | typeof VERSION_CONFLICT>;

  completeSessionTransaction(input: {
    sessionId: string;
    expectedVersion: number;
  }): Promise<SessionRow | typeof VERSION_CONFLICT | InvalidStateResult>;

  // Idempotency (shared table/mechanism with Phase 3's CreateMonth)
  findIdempotencyRecord(workspaceId: string, operation: string, key: string): Promise<IdempotencyRecordRow | undefined>;
  tryInsertIdempotencyRecord(input: {
    workspaceId: string;
    operation: string;
    key: string;
    requestHash: string;
    expiresAt: Date;
  }): Promise<IdempotencyRecordRow | undefined>;
  completeIdempotencyRecord(id: string, responseCode: number, responsePayload: unknown): Promise<void>;
  failIdempotencyRecord(id: string): Promise<void>;

  insertAuditEvent(input: SessionModeAuditEventInput): Promise<void>;
}

export const SESSION_MODE_REPOSITORY = Symbol("SESSION_MODE_REPOSITORY");
