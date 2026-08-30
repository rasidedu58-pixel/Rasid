import { Injectable } from "@nestjs/common";
import {
  applyScheduleChangeTransaction,
  cancelSessionIfScheduled,
  completeIdempotencyRecord,
  countStudentsWithOldDebt,
  failIdempotencyRecord,
  findGroupById,
  findGroupMonthById,
  findIdempotencyRecord,
  findOperatingMonthById,
  findOperatingMonthByYearMonth,
  findSessionById,
  findWorkspaceTimezone,
  getCarryForwardStats,
  insertGroup,
  insertSchedulingAuditEvent,
  listGroupMonthsForOperatingMonth,
  listGroupsForWorkspace,
  listOperatingMonthsForWorkspace,
  listScheduleRulesForGroupMonth,
  listSessions,
  listSessionsInRangeWithGroup,
  prepareGroupForCurrentMonthTransaction,
  rescheduleSessionTransaction,
  runCreateMonthTransaction,
  tryInsertIdempotencyRecord,
  updateGroupMonthWithVersion,
  updateGroupWithVersion,
  withRuntimeContext,
  type CarryForwardStats,
  type CreateMonthTransactionInput,
  type GroupMonthRow,
  type GroupRow,
  type IdempotencyRecordRow,
  type InsertGroupInput,
  type CalendarSessionRow,
  type ListSessionsFilter,
  type OperatingMonthRow,
  type PrepareGroupForCurrentMonthInput,
  type PrepareGroupForCurrentMonthResult,
  type RescheduleInput,
  type ScheduleApplyInput,
  type ScheduleRuleRow,
  type SchedulingAuditEventInput,
  type SessionRow,
  type UpdateGroupInput,
} from "@academic-precision/database";
import { getContext } from "@academic-precision/observability";
import type { SchedulingRepositoryPort } from "../application/ports/scheduling-repository.port";

/**
 * Real (PostgreSQL/Drizzle) implementation of {@link SchedulingRepositoryPort}.
 * Thin adapter only — all persistence/transaction logic lives in
 * packages/database, mirroring `DrizzleTeamRepository` (Phase 2). Every
 * method threads the ambient `ExecutionContext` (userId/workspaceId, set by
 * `RequestContextInterceptor` after `PermissionGuard` runs) through
 * `withRuntimeContext` so RLS admits the query.
 */
@Injectable()
export class DrizzleSchedulingRepository implements SchedulingRepositoryPort {
  private runtimeCtx(workspaceId?: string) {
    const ctx = getContext();
    return { userId: ctx?.userId, workspaceId: workspaceId ?? (ctx?.workspaceId as string | undefined) };
  }

  findWorkspaceTimezone(workspaceId: string): Promise<string | undefined> {
    return withRuntimeContext(this.runtimeCtx(workspaceId), (db) => findWorkspaceTimezone(db, workspaceId));
  }

  listGroups(workspaceId: string): Promise<GroupRow[]> {
    return withRuntimeContext(this.runtimeCtx(workspaceId), (db) => listGroupsForWorkspace(db, workspaceId));
  }

  findGroupById(groupId: string): Promise<GroupRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => findGroupById(db, groupId));
  }

  insertGroup(input: InsertGroupInput): Promise<GroupRow> {
    return withRuntimeContext(this.runtimeCtx(input.workspaceId), (db) => insertGroup(db, input));
  }

  updateGroupWithVersion(
    groupId: string,
    expectedVersion: number,
    patch: UpdateGroupInput,
  ): Promise<GroupRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => updateGroupWithVersion(db, groupId, expectedVersion, patch));
  }

  listOperatingMonths(workspaceId: string): Promise<OperatingMonthRow[]> {
    return withRuntimeContext(this.runtimeCtx(workspaceId), (db) => listOperatingMonthsForWorkspace(db, workspaceId));
  }

  findOperatingMonthById(id: string): Promise<OperatingMonthRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => findOperatingMonthById(db, id));
  }

  findOperatingMonthByYearMonth(
    workspaceId: string,
    year: number,
    month: number,
  ): Promise<OperatingMonthRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(workspaceId), (db) =>
      findOperatingMonthByYearMonth(db, workspaceId, year, month),
    );
  }

  listGroupMonthsForOperatingMonth(operatingMonthId: string): Promise<GroupMonthRow[]> {
    return withRuntimeContext(this.runtimeCtx(), (db) => listGroupMonthsForOperatingMonth(db, operatingMonthId));
  }

  findGroupMonthById(id: string): Promise<GroupMonthRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => findGroupMonthById(db, id));
  }

  listScheduleRulesForGroupMonth(groupMonthId: string): Promise<ScheduleRuleRow[]> {
    return withRuntimeContext(this.runtimeCtx(), (db) => listScheduleRulesForGroupMonth(db, groupMonthId));
  }

  updateGroupMonthWithVersion(
    groupMonthId: string,
    expectedVersion: number,
    patch: Partial<{
      locationId: string | null;
      baseFeeMinor: number;
      duePolicy: string;
      dueDay: number | null;
      joinFeePolicy: string;
    }>,
  ): Promise<GroupMonthRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) =>
      updateGroupMonthWithVersion(db, groupMonthId, expectedVersion, patch),
    );
  }

  applyScheduleChangeTransaction(input: ScheduleApplyInput) {
    return withRuntimeContext(this.runtimeCtx(input.workspaceId), (db) => applyScheduleChangeTransaction(db, input));
  }

  prepareGroupForCurrentMonth(input: PrepareGroupForCurrentMonthInput): Promise<PrepareGroupForCurrentMonthResult> {
    return withRuntimeContext(this.runtimeCtx(input.workspaceId), (db) => prepareGroupForCurrentMonthTransaction(db, input));
  }

  findSessionById(id: string): Promise<SessionRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => findSessionById(db, id));
  }

  listSessions(filter: ListSessionsFilter): Promise<SessionRow[]> {
    return withRuntimeContext(this.runtimeCtx(filter.workspaceId), (db) => listSessions(db, filter));
  }

  listSessionsInRangeWithGroup(filter: {
    workspaceId: string;
    scheduledFrom: Date;
    scheduledTo: Date;
    restrictToGroupIds?: string[];
  }): Promise<CalendarSessionRow[]> {
    return withRuntimeContext(this.runtimeCtx(filter.workspaceId), (db) => listSessionsInRangeWithGroup(db, filter));
  }

  cancelSessionIfScheduled(sessionId: string): Promise<SessionRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => cancelSessionIfScheduled(db, sessionId));
  }

  rescheduleSessionTransaction(input: RescheduleInput) {
    return withRuntimeContext(this.runtimeCtx(), (db) => rescheduleSessionTransaction(db, input));
  }

  runCreateMonthTransaction(input: CreateMonthTransactionInput) {
    return withRuntimeContext(this.runtimeCtx(input.workspaceId), (db) => runCreateMonthTransaction(db, input));
  }

  getCarryForwardStats(sourceGroupMonthId: string): Promise<CarryForwardStats> {
    return withRuntimeContext(this.runtimeCtx(), (db) => getCarryForwardStats(db, sourceGroupMonthId));
  }

  countStudentsWithOldDebt(workspaceId: string, studentIds: string[]): Promise<number> {
    return withRuntimeContext(this.runtimeCtx(workspaceId), (db) =>
      countStudentsWithOldDebt(db, workspaceId, studentIds),
    );
  }

  findIdempotencyRecord(
    workspaceId: string,
    operation: string,
    key: string,
  ): Promise<IdempotencyRecordRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(workspaceId), (db) =>
      findIdempotencyRecord(db, workspaceId, operation, key),
    );
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
    return withRuntimeContext(this.runtimeCtx(), (db) =>
      completeIdempotencyRecord(db, id, responseCode, responsePayload),
    );
  }

  failIdempotencyRecord(id: string): Promise<void> {
    return withRuntimeContext(this.runtimeCtx(), (db) => failIdempotencyRecord(db, id));
  }

  insertAuditEvent(input: SchedulingAuditEventInput): Promise<void> {
    return withRuntimeContext(this.runtimeCtx(input.workspaceId), (db) => insertSchedulingAuditEvent(db, input));
  }
}
