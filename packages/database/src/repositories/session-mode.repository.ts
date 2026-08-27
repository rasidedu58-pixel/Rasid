/**
 * Session Mode repository — Phase 5.
 *
 * Typed query helpers + transactional operations, containing no HTTP/
 * framework concerns — mirrors `students.repository.ts`/
 * `scheduling.repository.ts`'s convention exactly. Business/authorization
 * decisions (permission checks, review/canComplete computation) live in
 * apps/api's application service layer, NOT here.
 *
 * Every mutating operation below is guarded by the SAME session-level
 * optimistic-concurrency counter (`sessions.version`) — attendance/
 * homework/exam-score batches, the two "mark all" bulk commands, and
 * completion all bump it by exactly 1 per call and reject a stale
 * `expectedVersion` with the `"VERSION_CONFLICT"` sentinel. `session_exams`
 * carries its OWN independent `version` (exam definition is edited
 * separately from the roster's record-taking).
 */
import { and, eq, inArray, sql as rawSql } from "drizzle-orm";
import { sessions } from "../schema/sessions";
import { sessionExams } from "../schema/session-exams";
import { sessionRecords } from "../schema/session-records";
import { enrollments } from "../schema/enrollments";
import { students } from "../schema/students";
import { auditEvents } from "../schema/audit";
import { featureFlags } from "../schema/feature-flags";
import { outboxEvents } from "../schema/outbox";
import type { Db } from "./identity.repository";
import type { SessionRow } from "./scheduling.repository";

export type SessionExamRow = typeof sessionExams.$inferSelect;
export type SessionRecordRow = typeof sessionRecords.$inferSelect;

const IN_PROGRESS = "IN_PROGRESS";

// ---------------------------------------------------------------------------
// Sentinel result types (transaction outcomes other than success)
// ---------------------------------------------------------------------------

export const VERSION_CONFLICT = "VERSION_CONFLICT" as const;
export interface InvalidStateResult {
  kind: "INVALID_STATE";
  status: string;
}
export interface InvalidEnrollmentResult {
  kind: "INVALID_ENROLLMENT";
  ids: string[];
}

type BatchFailure = typeof VERSION_CONFLICT | InvalidStateResult | InvalidEnrollmentResult;

class VersionConflictMarker extends Error {}
class NotInProgressMarker extends Error {
  constructor(public status: string) {
    super();
  }
}
class InvalidEnrollmentMarker extends Error {
  constructor(public ids: string[]) {
    super();
  }
}

/**
 * Shared guard for every record-writing Session Mode transaction: bumps
 * `sessions.version` (optimistic concurrency, WHERE-clause guarded — no
 * silent last-write-wins), requires the session to already be IN_PROGRESS,
 * and — when `enrollmentIds` is supplied — verifies every one of them
 * belongs to `groupMonthId` (the actual cross-group / out-of-roster guard;
 * `session_records`' own composite FKs are the DB-level backstop, this is
 * the pre-check that turns a would-be FK violation into a clean typed
 * result instead of a raw constraint-violation 500).
 */
async function withSessionVersionGuard<T>(
  db: Db,
  params: { sessionId: string; groupMonthId: string; expectedVersion: number; enrollmentIds?: string[] },
  callback: (tx: Db, session: SessionRow) => Promise<T>,
): Promise<T | BatchFailure> {
  try {
    return await db.transaction(async (tx) => {
      const [session] = await tx
        .update(sessions)
        .set({ version: params.expectedVersion + 1, updatedAt: new Date() })
        .where(and(eq(sessions.id, params.sessionId), eq(sessions.version, params.expectedVersion)))
        .returning();
      if (!session) throw new VersionConflictMarker();
      if (session.status !== IN_PROGRESS) throw new NotInProgressMarker(session.status);

      if (params.enrollmentIds && params.enrollmentIds.length > 0) {
        const uniqueIds = [...new Set(params.enrollmentIds)];
        const validRows = await tx
          .select({ id: enrollments.id })
          .from(enrollments)
          .where(and(inArray(enrollments.id, uniqueIds), eq(enrollments.groupMonthId, params.groupMonthId)));
        const validSet = new Set(validRows.map((r) => r.id));
        const invalid = uniqueIds.filter((id) => !validSet.has(id));
        if (invalid.length > 0) throw new InvalidEnrollmentMarker(invalid);
      }

      return callback(tx, session);
    });
  } catch (err) {
    if (err instanceof VersionConflictMarker) return VERSION_CONFLICT;
    if (err instanceof NotInProgressMarker) return { kind: "INVALID_STATE", status: err.status };
    if (err instanceof InvalidEnrollmentMarker) return { kind: "INVALID_ENROLLMENT", ids: err.ids };
    throw err;
  }
}

export function isBatchFailure(result: unknown): result is BatchFailure {
  return result === VERSION_CONFLICT || (typeof result === "object" && result !== null && "kind" in result);
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

export interface RosterEnrollmentRow {
  enrollmentId: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  joinDate: string;
  endedAt: Date | null;
}

export async function listEnrollmentsForRoster(db: Db, groupMonthId: string): Promise<RosterEnrollmentRow[]> {
  const rows = await db
    .select({
      enrollmentId: enrollments.id,
      studentId: students.id,
      studentName: students.name,
      studentCode: students.studentCode,
      joinDate: enrollments.joinDate,
      endedAt: enrollments.endedAt,
    })
    .from(enrollments)
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .where(eq(enrollments.groupMonthId, groupMonthId));
  return rows;
}

// ---------------------------------------------------------------------------
// Session Records (read)
// ---------------------------------------------------------------------------

export function findSessionRecordsForSession(db: Db, sessionId: string): Promise<SessionRecordRow[]> {
  return db.select().from(sessionRecords).where(eq(sessionRecords.sessionId, sessionId));
}

// ---------------------------------------------------------------------------
// Session start
// ---------------------------------------------------------------------------

export async function startSessionTransaction(
  db: Db,
  input: { sessionId: string; expectedVersion: number },
): Promise<SessionRow | typeof VERSION_CONFLICT | InvalidStateResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(sessions).where(eq(sessions.id, input.sessionId)).limit(1);
    if (!current) return VERSION_CONFLICT; // caller already verified existence; treat as conflict-safe no-op
    if (current.status !== "SCHEDULED") {
      return { kind: "INVALID_STATE", status: current.status } as InvalidStateResult;
    }
    const [updated] = await tx
      .update(sessions)
      .set({ status: IN_PROGRESS, startedAt: new Date(), version: input.expectedVersion + 1, updatedAt: new Date() })
      .where(and(eq(sessions.id, input.sessionId), eq(sessions.version, input.expectedVersion)))
      .returning();
    return updated ?? VERSION_CONFLICT;
  });
}

// ---------------------------------------------------------------------------
// Attendance batch
// ---------------------------------------------------------------------------

export interface AttendanceRecordInput {
  enrollmentId: string;
  status: "PRESENT" | "ABSENT" | "LATE";
}

export async function applyAttendanceBatchTransaction(
  db: Db,
  input: {
    sessionId: string;
    workspaceId: string;
    groupMonthId: string;
    expectedVersion: number;
    records: AttendanceRecordInput[];
    actorUserId: string;
  },
): Promise<{ session: SessionRow } | BatchFailure> {
  return withSessionVersionGuard(
    db,
    {
      sessionId: input.sessionId,
      groupMonthId: input.groupMonthId,
      expectedVersion: input.expectedVersion,
      enrollmentIds: input.records.map((r) => r.enrollmentId),
    },
    async (tx, session) => {
      await bulkUpsertSessionRecordPatches(tx, {
        workspaceId: input.workspaceId,
        groupMonthId: input.groupMonthId,
        sessionId: input.sessionId,
        actorUserId: input.actorUserId,
        records: input.records.map((record) => ({ enrollmentId: record.enrollmentId, patch: { attendanceStatus: record.status } })),
      });
      return { session };
    },
  );
}

// ---------------------------------------------------------------------------
// Homework batch
// ---------------------------------------------------------------------------

export interface HomeworkRecordInput {
  enrollmentId: string;
  status: "DONE" | "PARTIAL" | "NOT_DONE" | "NO_HOMEWORK";
}

export async function applyHomeworkBatchTransaction(
  db: Db,
  input: {
    sessionId: string;
    workspaceId: string;
    groupMonthId: string;
    expectedVersion: number;
    records: HomeworkRecordInput[];
    actorUserId: string;
  },
): Promise<{ session: SessionRow } | BatchFailure> {
  return withSessionVersionGuard(
    db,
    {
      sessionId: input.sessionId,
      groupMonthId: input.groupMonthId,
      expectedVersion: input.expectedVersion,
      enrollmentIds: input.records.map((r) => r.enrollmentId),
    },
    async (tx, session) => {
      // Absence never suppresses homework — this writes ONLY the homework
      // column, leaving any already-recorded attendance_status (however it
      // was set) completely untouched.
      await bulkUpsertSessionRecordPatches(tx, {
        workspaceId: input.workspaceId,
        groupMonthId: input.groupMonthId,
        sessionId: input.sessionId,
        actorUserId: input.actorUserId,
        records: input.records.map((record) => ({ enrollmentId: record.enrollmentId, patch: { homeworkStatus: record.status } })),
      });
      return { session };
    },
  );
}

// ---------------------------------------------------------------------------
// Exam scores batch
// ---------------------------------------------------------------------------

export interface ExamScoreRecordInput {
  enrollmentId: string;
  status: "SCORED" | "ABSENT_FROM_EXAM";
  score?: number;
}

export interface ExamNotDefinedResult {
  kind: "EXAM_NOT_DEFINED";
}
export interface ExamScoreOutOfRangeResult {
  kind: "EXAM_SCORE_OUT_OF_RANGE";
  enrollmentId: string;
}

class ExamNotDefinedMarker extends Error {}
class ExamScoreOutOfRangeMarker extends Error {
  constructor(public enrollmentId: string) {
    super();
  }
}

export async function applyExamScoresBatchTransaction(
  db: Db,
  input: {
    sessionId: string;
    workspaceId: string;
    groupMonthId: string;
    expectedVersion: number;
    records: ExamScoreRecordInput[];
    actorUserId: string;
  },
): Promise<{ session: SessionRow } | BatchFailure | ExamNotDefinedResult | ExamScoreOutOfRangeResult> {
  // `withSessionVersionGuard` only recognizes its OWN three marker types and
  // re-throws anything else — so ExamNotDefinedMarker/ExamScoreOutOfRangeMarker
  // (thrown from inside the callback below) propagate out of the `await`
  // itself rather than being returned as a value. Caught here explicitly.
  try {
    return await withSessionVersionGuard(
      db,
      {
        sessionId: input.sessionId,
        groupMonthId: input.groupMonthId,
        expectedVersion: input.expectedVersion,
        enrollmentIds: input.records.map((r) => r.enrollmentId),
      },
      async (tx, session) => {
        const [exam] = await tx.select().from(sessionExams).where(eq(sessionExams.sessionId, input.sessionId)).limit(1);
        if (!exam) throw new ExamNotDefinedMarker();

        const maxScore = Number(exam.maxScore);
        // Validate every record first (pure JS — no DB), then write the whole
        // batch in one upsert. Validation still throws on the FIRST offending
        // record, exactly as before, so a bad batch writes nothing.
        const records: Array<{ enrollmentId: string; patch: SessionRecordPatch }> = [];
        for (const record of input.records) {
          if (record.status === "SCORED") {
            if (record.score === undefined || record.score < 0 || record.score > maxScore) {
              throw new ExamScoreOutOfRangeMarker(record.enrollmentId);
            }
          }
          records.push({
            enrollmentId: record.enrollmentId,
            patch:
              record.status === "SCORED"
                ? { examStatus: "SCORED", examScore: record.score!.toString() }
                : { examStatus: "ABSENT_FROM_EXAM", examScore: null },
          });
        }
        await bulkUpsertSessionRecordPatches(tx, {
          workspaceId: input.workspaceId,
          groupMonthId: input.groupMonthId,
          sessionId: input.sessionId,
          actorUserId: input.actorUserId,
          records,
        });
        return { session };
      },
    );
  } catch (err) {
    if (err instanceof ExamNotDefinedMarker) return { kind: "EXAM_NOT_DEFINED" };
    if (err instanceof ExamScoreOutOfRangeMarker) return { kind: "EXAM_SCORE_OUT_OF_RANGE", enrollmentId: err.enrollmentId };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Internal: single session_record upsert
// ---------------------------------------------------------------------------

interface UpsertSessionRecordPatchInput {
  workspaceId: string;
  groupMonthId: string;
  sessionId: string;
  enrollmentId: string;
  actorUserId: string;
  patch: Partial<{
    attendanceStatus: string;
    homeworkStatus: string;
    examStatus: string;
    /** Numeric-as-string (drizzle-orm `numeric` column convention) — callers convert before building the patch. */
    examScore: string | null;
  }>;
}

type SessionRecordPatch = UpsertSessionRecordPatchInput["patch"];

/**
 * Phase 15D.1 — bulk counterpart of the former per-row `upsertSessionRecordPatch`.
 *
 * Attendance/homework/exam batches used to call the single-row upsert once
 * PER record — N sequential DB round-trips inside one transaction, each
 * ~75-150ms on the eu-west pooler, so a 30-student class held its connection
 * for ~2-4s. This issues ONE multi-row `INSERT ... ON CONFLICT DO UPDATE`.
 *
 * Semantics are preserved EXACTLY:
 * - Partial-field independence: the conflict `SET` updates ONLY the columns
 *   present in this batch's patch shape (via `excluded.<col>`), so a homework
 *   batch never touches attendance_status/exam_*, and vice versa — identical
 *   to the old `set: { ...patch }`. Insert defaults for absent columns
 *   (`homework_status = NULL`, `exam_status = 'NO_EXAM'`, `exam_score = NULL`)
 *   match the old row-at-a-time inserts, so first-time rows are byte-identical.
 * - `version = version + 1`, `updated_by`, `updated_at` bumped on conflict.
 * - Duplicate enrollmentIds in one payload are collapsed keeping the LAST
 *   occurrence — the same final stored state the old sequential "last write
 *   wins" loop produced (and it avoids Postgres's "cannot affect row a second
 *   time" error a naive multi-row upsert would hit). All patches in a single
 *   batch share the same key shape, so the derived SET is uniform.
 */
async function bulkUpsertSessionRecordPatches(
  tx: Db,
  input: {
    workspaceId: string;
    groupMonthId: string;
    sessionId: string;
    actorUserId: string;
    records: Array<{ enrollmentId: string; patch: SessionRecordPatch }>;
  },
): Promise<void> {
  if (input.records.length === 0) return;

  // Last-write-wins dedupe by enrollmentId (preserves input order for the rest).
  const byEnrollment = new Map<string, SessionRecordPatch>();
  for (const r of input.records) byEnrollment.set(r.enrollmentId, r.patch);

  const values = [...byEnrollment.entries()].map(([enrollmentId, patch]) => ({
    workspaceId: input.workspaceId,
    groupMonthId: input.groupMonthId,
    sessionId: input.sessionId,
    enrollmentId,
    attendanceStatus: patch.attendanceStatus ?? null,
    homeworkStatus: patch.homeworkStatus ?? null,
    examStatus: patch.examStatus ?? "NO_EXAM",
    examScore: patch.examScore ?? null,
    createdBy: input.actorUserId,
    updatedBy: input.actorUserId,
  }));

  // Update ONLY the columns this batch actually patches (uniform across the
  // batch), mirroring the old `set: { ...patch }` exactly.
  const patchKeys = new Set<keyof SessionRecordPatch>();
  for (const patch of byEnrollment.values()) {
    for (const key of Object.keys(patch) as Array<keyof SessionRecordPatch>) patchKeys.add(key);
  }
  const set: Record<string, unknown> = {
    updatedBy: input.actorUserId,
    updatedAt: new Date(),
    version: rawSql`${sessionRecords.version} + 1`,
  };
  if (patchKeys.has("attendanceStatus")) set.attendanceStatus = rawSql`excluded.attendance_status`;
  if (patchKeys.has("homeworkStatus")) set.homeworkStatus = rawSql`excluded.homework_status`;
  if (patchKeys.has("examStatus")) set.examStatus = rawSql`excluded.exam_status`;
  if (patchKeys.has("examScore")) set.examScore = rawSql`excluded.exam_score`;

  await tx
    .insert(sessionRecords)
    .values(values)
    .onConflictDoUpdate({ target: [sessionRecords.sessionId, sessionRecords.enrollmentId], set });
}

// ---------------------------------------------------------------------------
// Session exams (definition)
// ---------------------------------------------------------------------------

export function findSessionExamBySessionId(db: Db, sessionId: string): Promise<SessionExamRow | undefined> {
  return db.select().from(sessionExams).where(eq(sessionExams.sessionId, sessionId)).limit(1).then((r) => r[0]);
}

export interface UpsertSessionExamInput {
  workspaceId: string;
  sessionId: string;
  name: string | null;
  maxScore: number;
  lowScoreThreshold: number | null;
  /** undefined => first-time creation; provided => optimistic-concurrency update of the existing row. */
  expectedVersion?: number;
}

export async function upsertSessionExamTransaction(
  db: Db,
  input: UpsertSessionExamInput,
): Promise<SessionExamRow | typeof VERSION_CONFLICT> {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(sessionExams).where(eq(sessionExams.sessionId, input.sessionId)).limit(1);

    if (!existing) {
      const [inserted] = await tx
        .insert(sessionExams)
        .values({
          workspaceId: input.workspaceId,
          sessionId: input.sessionId,
          name: input.name,
          maxScore: input.maxScore.toString(),
          lowScoreThreshold: input.lowScoreThreshold === null ? null : input.lowScoreThreshold.toString(),
        })
        .returning();
      if (!inserted) throw new Error("Failed to insert session_exams row.");
      return inserted;
    }

    if (input.expectedVersion === undefined || existing.version !== input.expectedVersion) {
      return VERSION_CONFLICT;
    }
    const [updated] = await tx
      .update(sessionExams)
      .set({
        name: input.name,
        maxScore: input.maxScore.toString(),
        lowScoreThreshold: input.lowScoreThreshold === null ? null : input.lowScoreThreshold.toString(),
        updatedAt: new Date(),
        version: existing.version + 1,
      })
      .where(eq(sessionExams.id, existing.id))
      .returning();
    return updated ?? VERSION_CONFLICT;
  });
}

// ---------------------------------------------------------------------------
// Complete
// ---------------------------------------------------------------------------

export async function completeSessionTransaction(
  db: Db,
  input: { sessionId: string; expectedVersion: number },
): Promise<SessionRow | typeof VERSION_CONFLICT | InvalidStateResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(sessions).where(eq(sessions.id, input.sessionId)).limit(1);
    if (!current) return VERSION_CONFLICT;
    if (current.status !== IN_PROGRESS) {
      return { kind: "INVALID_STATE", status: current.status } as InvalidStateResult;
    }
    const [updated] = await tx
      .update(sessions)
      .set({ status: "COMPLETED", completedAt: new Date(), version: input.expectedVersion + 1, updatedAt: new Date() })
      .where(and(eq(sessions.id, input.sessionId), eq(sessions.version, input.expectedVersion)))
      .returning();
    if (!updated) return VERSION_CONFLICT;

    // Technical Architecture ADR-018 + Database Schema §17.2 step 7 — the
    // Session/records final state and its OutboxEvent commit together or
    // roll back together. No consumer processes this yet (Attention Engine
    // is a later phase) — it accumulates as PENDING infrastructure.
    await tx.insert(outboxEvents).values({
      workspaceId: updated.workspaceId,
      eventType: "SessionCompleted",
      aggregateType: "Session",
      aggregateId: updated.id,
      payload: { sessionId: updated.id, groupMonthId: updated.groupMonthId, completedAt: updated.completedAt },
    });

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Feature flags (Phase 5 Closure Delta)
// ---------------------------------------------------------------------------

/**
 * Reads a single global flag's `enabled` value. Returns `undefined` when
 * the key has no row (defensive — the caller decides the fallback; the
 * approved default is `false` for `complete_session_with_missing_records`,
 * seeded by migration 0023, so this should only be `undefined` if that seed
 * is ever missing).
 */
export async function findFeatureFlagEnabled(db: Db, key: string): Promise<boolean | undefined> {
  const [row] = await db.select({ enabled: featureFlags.enabled }).from(featureFlags).where(eq(featureFlags.key, key)).limit(1);
  return row?.enabled;
}

// ---------------------------------------------------------------------------
// Audit (re-declared here rather than importing students.repository.ts's
// insertStudentsAuditEvent, to keep this module's public surface
// self-contained — same audit_events table, same shape, matches the
// Phase 3/4 convention of each domain module owning its own thin wrapper).
// ---------------------------------------------------------------------------

export interface SessionModeAuditEventInput {
  workspaceId: string;
  actorUserId: string | null;
  actorMembershipId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  beforeJson?: unknown;
  afterJson?: unknown;
  reason?: string | null;
  correlationId?: string | null;
}

export async function insertSessionModeAuditEvent(db: Db, input: SessionModeAuditEventInput): Promise<void> {
  await db.insert(auditEvents).values({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    actorMembershipId: input.actorMembershipId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    beforeJson: input.beforeJson ?? null,
    afterJson: input.afterJson ?? null,
    reason: input.reason ?? null,
    correlationId: input.correlationId ?? null,
  });
}
