import { Injectable } from "@nestjs/common";
import {
  applyAttendanceBatchTransaction,
  applyExamScoresBatchTransaction,
  applyHomeworkBatchTransaction,
  completeIdempotencyRecord,
  completeSessionTransaction,
  failIdempotencyRecord,
  findFeatureFlagEnabled,
  resolveActiveFeatureOverride,
  findGroupById,
  findGroupMonthById,
  findIdempotencyRecord,
  findSessionById,
  findSessionExamBySessionId,
  findSessionRecordsForSession,
  findWorkspaceTimezone,
  insertSessionModeAuditEvent,
  listEnrollmentsForRoster,
  startSessionTransaction,
  tryInsertIdempotencyRecord,
  upsertSessionExamTransaction,
  withRuntimeContext,
  type AttendanceRecordInput,
  type ExamScoreRecordInput,
  type GroupMonthRow,
  type GroupRow,
  type HomeworkRecordInput,
  type IdempotencyRecordRow,
  type RosterEnrollmentRow,
  type SessionExamRow,
  type SessionModeAuditEventInput,
  type SessionRecordRow,
  type SessionRow,
  type UpsertSessionExamInput,
} from "@academic-precision/database";
import { getContext } from "@academic-precision/observability";
import { isPlatformFeatureKey } from "@academic-precision/contracts";
import type { SessionModeRepositoryPort } from "../application/ports/session-mode-repository.port";

/**
 * Real (PostgreSQL/Drizzle) implementation of {@link SessionModeRepositoryPort}.
 * Thin adapter only — all persistence/transaction logic lives in
 * packages/database, mirroring `DrizzleStudentsRepository` (Phase 4). Every
 * method threads the ambient `ExecutionContext` (userId/workspaceId, set by
 * `RequestContextInterceptor` after `PermissionGuard` runs) through
 * `withRuntimeContext` so RLS admits the query.
 */
@Injectable()
export class DrizzleSessionModeRepository implements SessionModeRepositoryPort {
  private runtimeCtx(workspaceId?: string) {
    const ctx = getContext();
    return { userId: ctx?.userId, workspaceId: workspaceId ?? (ctx?.workspaceId as string | undefined) };
  }

  findWorkspaceTimezone(workspaceId: string): Promise<string | undefined> {
    return withRuntimeContext(this.runtimeCtx(workspaceId), (db) => findWorkspaceTimezone(db, workspaceId));
  }

  findGroupMonthById(id: string): Promise<GroupMonthRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => findGroupMonthById(db, id));
  }

  findGroupById(id: string): Promise<GroupRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => findGroupById(db, id));
  }

  findSessionById(id: string): Promise<SessionRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => findSessionById(db, id));
  }

  listEnrollmentsForRoster(groupMonthId: string): Promise<RosterEnrollmentRow[]> {
    return withRuntimeContext(this.runtimeCtx(), (db) => listEnrollmentsForRoster(db, groupMonthId));
  }

  findSessionRecordsForSession(sessionId: string): Promise<SessionRecordRow[]> {
    return withRuntimeContext(this.runtimeCtx(), (db) => findSessionRecordsForSession(db, sessionId));
  }

  findSessionExamBySessionId(sessionId: string): Promise<SessionExamRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => findSessionExamBySessionId(db, sessionId));
  }

  startSessionTransaction(input: { sessionId: string; expectedVersion: number }) {
    return withRuntimeContext(this.runtimeCtx(), (db) => startSessionTransaction(db, input));
  }

  applyAttendanceBatchTransaction(input: {
    sessionId: string;
    workspaceId: string;
    groupMonthId: string;
    expectedVersion: number;
    records: AttendanceRecordInput[];
    actorUserId: string;
  }) {
    return withRuntimeContext(this.runtimeCtx(input.workspaceId), (db) => applyAttendanceBatchTransaction(db, input));
  }

  applyHomeworkBatchTransaction(input: {
    sessionId: string;
    workspaceId: string;
    groupMonthId: string;
    expectedVersion: number;
    records: HomeworkRecordInput[];
    actorUserId: string;
  }) {
    return withRuntimeContext(this.runtimeCtx(input.workspaceId), (db) => applyHomeworkBatchTransaction(db, input));
  }

  applyExamScoresBatchTransaction(input: {
    sessionId: string;
    workspaceId: string;
    groupMonthId: string;
    expectedVersion: number;
    records: ExamScoreRecordInput[];
    actorUserId: string;
  }) {
    return withRuntimeContext(this.runtimeCtx(input.workspaceId), (db) => applyExamScoresBatchTransaction(db, input));
  }

  upsertSessionExamTransaction(input: UpsertSessionExamInput) {
    return withRuntimeContext(this.runtimeCtx(input.workspaceId), (db) => upsertSessionExamTransaction(db, input));
  }

  findFeatureFlagEnabled(key: string): Promise<boolean | undefined> {
    // Precedence: GLOBAL feature_flags value, then (for catalog features only) a
    // per-workspace override WINS — ENABLE turns the feature on even when the
    // global flag is false, DISABLE turns it off. This is intentional and safe:
    // our global feature_flags are "default rollout state" toggles (a feature
    // globally-off-by-default that Ops enables per customer), NOT hard kill
    // switches. The SAFETY BOUNDARY is the catalog: only default-rollout-state
    // features appear in PLATFORM_FEATURE_CATALOG, so only they are override-able
    // at all — a hard kill switch would simply never be added to the catalog,
    // and `isPlatformFeatureKey` below would reject it, leaving the global value
    // as the final word. With no override present the result is exactly the
    // global flag (today's behavior).
    const ctx = this.runtimeCtx();
    return withRuntimeContext(ctx, async (db) => {
      const global = await findFeatureFlagEnabled(db, key);
      if (ctx.workspaceId && isPlatformFeatureKey(key)) {
        const override = await resolveActiveFeatureOverride(db, ctx.workspaceId, key);
        if (override) return override === "ENABLED";
      }
      return global;
    });
  }

  completeSessionTransaction(input: { sessionId: string; expectedVersion: number }) {
    return withRuntimeContext(this.runtimeCtx(), (db) => completeSessionTransaction(db, input));
  }

  findIdempotencyRecord(workspaceId: string, operation: string, key: string): Promise<IdempotencyRecordRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(workspaceId), (db) => findIdempotencyRecord(db, workspaceId, operation, key));
  }

  tryInsertIdempotencyRecord(input: {
    workspaceId: string;
    operation: string;
    key: string;
    requestHash: string;
    expiresAt: Date;
  }): Promise<IdempotencyRecordRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(input.workspaceId), (db) => tryInsertIdempotencyRecord(db, input));
  }

  completeIdempotencyRecord(id: string, responseCode: number, responsePayload: unknown): Promise<void> {
    return withRuntimeContext(this.runtimeCtx(), (db) => completeIdempotencyRecord(db, id, responseCode, responsePayload));
  }

  failIdempotencyRecord(id: string): Promise<void> {
    return withRuntimeContext(this.runtimeCtx(), (db) => failIdempotencyRecord(db, id));
  }

  insertAuditEvent(input: SessionModeAuditEventInput): Promise<void> {
    return withRuntimeContext(this.runtimeCtx(input.workspaceId), (db) => insertSessionModeAuditEvent(db, input));
  }
}
