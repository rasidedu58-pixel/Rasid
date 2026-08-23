/**
 * Scheduling repository — Phase 3 (Months / Groups / Scheduling).
 *
 * Typed query helpers + the transactional CreateMonth / GroupMonth-change /
 * Schedule-change / Session cancel+reschedule operations. Contains no
 * HTTP/framework concerns; callers (apps/api) inject a database handle —
 * mirrors the Phase 1/2 `identity.repository.ts` / `permissions.repository.ts`
 * convention exactly.
 *
 * Business/authorization decisions (permission checks, preview-token
 * validation, Owner-only enforcement) live in apps/api's application
 * service layer, NOT here — this module only guarantees the *mechanical*
 * transactional integrity of each operation (atomic writes, idempotency
 * race handling, optimistic-concurrency version checks at the SQL level).
 */
import { and, asc, desc, eq, gt, gte, lte, sql as rawSql } from "drizzle-orm";
import { groupMonths, groups, scheduleRules } from "../schema/groups";
import { locations, operatingMonths } from "../schema/months";
import { sessions } from "../schema/sessions";
import { idempotencyRecords } from "../schema/idempotency";
import { auditEvents } from "../schema/audit";
import { workspaces } from "../schema/workspaces";
// `WorkspaceRow` is already exported by identity.repository.ts (same
// underlying `workspaces` table) — re-used here (not redeclared) to avoid
// a duplicate-export name collision at the package barrel.
import type { Db, WorkspaceRow } from "./identity.repository";
import {
  generateSessionOccurrencesForRules,
  type ScheduleRuleInput,
} from "../scheduling/session-generator";

export type LocationRow = typeof locations.$inferSelect;
export type OperatingMonthRow = typeof operatingMonths.$inferSelect;
export type GroupRow = typeof groups.$inferSelect;
export type GroupMonthRow = typeof groupMonths.$inferSelect;
export type ScheduleRuleRow = typeof scheduleRules.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type IdempotencyRecordRow = typeof idempotencyRecords.$inferSelect;

const CURRENT_MONTH_STATUS = "CURRENT";
const ARCHIVED_MONTH_STATUS = "ARCHIVED";
const SCHEDULED_SESSION_STATUS = "SCHEDULED";
const CANCELLED_SESSION_STATUS = "CANCELLED";
const RESCHEDULED_SESSION_STATUS = "RESCHEDULED";
const GENERATED_ORIGIN = "GENERATED";
const RESCHEDULE_REPLACEMENT_ORIGIN = "RESCHEDULE_REPLACEMENT";

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

/** Used by the CreateMonth/schedule application flow, which needs the workspace's IANA timezone for calendar math (Technical Architecture §8). */
export async function findWorkspaceTimezone(db: Db, workspaceId: string): Promise<string | undefined> {
  const rows = await db
    .select({ timezone: workspaces.timezone })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return rows[0]?.timezone;
}

/** Phase 6 — full workspace row, needed for `due_date_policy`/`unified_due_day` when resolving an obligation's due_date. */
export function findWorkspaceById(db: Db, id: string): Promise<WorkspaceRow | undefined> {
  return db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1).then((rows) => rows[0]);
}

export function findGroupById(db: Db, groupId: string): Promise<GroupRow | undefined> {
  return db.select().from(groups).where(eq(groups.id, groupId)).limit(1).then((rows) => rows[0]);
}

export function listGroupsForWorkspace(db: Db, workspaceId: string): Promise<GroupRow[]> {
  return db.select().from(groups).where(eq(groups.workspaceId, workspaceId));
}

export interface InsertGroupInput {
  workspaceId: string;
  name: string;
  subject?: string | null;
  grade?: string | null;
  defaultLocationId?: string | null;
}

export async function insertGroup(db: Db, input: InsertGroupInput): Promise<GroupRow> {
  const [inserted] = await db
    .insert(groups)
    .values({
      workspaceId: input.workspaceId,
      name: input.name,
      subject: input.subject ?? null,
      grade: input.grade ?? null,
      defaultLocationId: input.defaultLocationId ?? null,
    })
    .returning();
  if (!inserted) throw new Error("Failed to insert groups row.");
  return inserted;
}

export interface UpdateGroupInput {
  name?: string;
  subject?: string | null;
  grade?: string | null;
  defaultLocationId?: string | null;
  status?: "ACTIVE" | "ARCHIVED";
}

/** Optimistic-concurrency update: returns undefined if `expectedVersion` no longer matches the stored row (409 VERSION_CONFLICT at the service layer). */
export async function updateGroupWithVersion(
  db: Db,
  groupId: string,
  expectedVersion: number,
  patch: UpdateGroupInput,
): Promise<GroupRow | undefined> {
  const [updated] = await db
    .update(groups)
    .set({
      ...patch,
      updatedAt: new Date(),
      version: expectedVersion + 1,
    })
    .where(and(eq(groups.id, groupId), eq(groups.version, expectedVersion)))
    .returning();
  return updated;
}

// ---------------------------------------------------------------------------
// Operating months
// ---------------------------------------------------------------------------

export function findOperatingMonthById(db: Db, id: string): Promise<OperatingMonthRow | undefined> {
  return db
    .select()
    .from(operatingMonths)
    .where(eq(operatingMonths.id, id))
    .limit(1)
    .then((rows) => rows[0]);
}

export function listOperatingMonthsForWorkspace(db: Db, workspaceId: string): Promise<OperatingMonthRow[]> {
  return db
    .select()
    .from(operatingMonths)
    .where(eq(operatingMonths.workspaceId, workspaceId))
    .orderBy(desc(operatingMonths.year), desc(operatingMonths.month));
}

export function findOperatingMonthByYearMonth(
  db: Db,
  workspaceId: string,
  year: number,
  month: number,
): Promise<OperatingMonthRow | undefined> {
  return db
    .select()
    .from(operatingMonths)
    .where(
      and(
        eq(operatingMonths.workspaceId, workspaceId),
        eq(operatingMonths.year, year),
        eq(operatingMonths.month, month),
      ),
    )
    .limit(1)
    .then((rows) => rows[0]);
}

export function findCurrentOperatingMonth(db: Db, workspaceId: string): Promise<OperatingMonthRow | undefined> {
  return db
    .select()
    .from(operatingMonths)
    .where(and(eq(operatingMonths.workspaceId, workspaceId), eq(operatingMonths.status, CURRENT_MONTH_STATUS)))
    .limit(1)
    .then((rows) => rows[0]);
}

// ---------------------------------------------------------------------------
// Group months / schedule rules
// ---------------------------------------------------------------------------

export function findGroupMonthById(db: Db, id: string): Promise<GroupMonthRow | undefined> {
  return db
    .select()
    .from(groupMonths)
    .where(eq(groupMonths.id, id))
    .limit(1)
    .then((rows) => rows[0]);
}

export function listGroupMonthsForOperatingMonth(db: Db, operatingMonthId: string): Promise<GroupMonthRow[]> {
  return db.select().from(groupMonths).where(eq(groupMonths.operatingMonthId, operatingMonthId));
}

export function listScheduleRulesForGroupMonth(db: Db, groupMonthId: string): Promise<ScheduleRuleRow[]> {
  return db.select().from(scheduleRules).where(eq(scheduleRules.groupMonthId, groupMonthId));
}

/** Optimistic-concurrency update of a group_month's commercial fields. */
export async function updateGroupMonthWithVersion(
  db: Db,
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
  const [updated] = await db
    .update(groupMonths)
    .set({ ...patch, updatedAt: new Date(), version: expectedVersion + 1 })
    .where(and(eq(groupMonths.id, groupMonthId), eq(groupMonths.version, expectedVersion)))
    .returning();
  return updated;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export function findSessionById(db: Db, id: string): Promise<SessionRow | undefined> {
  return db.select().from(sessions).where(eq(sessions.id, id)).limit(1).then((rows) => rows[0]);
}

export interface ListSessionsFilter {
  workspaceId: string;
  groupMonthId?: string;
  status?: string;
  scheduledFrom?: Date;
  scheduledTo?: Date;
  limit: number;
  /** Cursor = the scheduledAt ISO string + id of the last item of the previous page. */
  cursorScheduledAt?: Date;
  cursorId?: string;
}

export async function listSessions(db: Db, filter: ListSessionsFilter): Promise<SessionRow[]> {
  const conditions = [eq(sessions.workspaceId, filter.workspaceId)];
  if (filter.groupMonthId) conditions.push(eq(sessions.groupMonthId, filter.groupMonthId));
  if (filter.status) conditions.push(eq(sessions.status, filter.status));
  if (filter.scheduledFrom) conditions.push(gte(sessions.scheduledAt, filter.scheduledFrom));
  if (filter.scheduledTo) conditions.push(lte(sessions.scheduledAt, filter.scheduledTo));
  if (filter.cursorScheduledAt && filter.cursorId) {
    conditions.push(
      rawSql`(${sessions.scheduledAt}, ${sessions.id}) > (${filter.cursorScheduledAt.toISOString()}::timestamptz, ${filter.cursorId})`,
    );
  }

  return db
    .select()
    .from(sessions)
    .where(and(...conditions))
    .orderBy(asc(sessions.scheduledAt), asc(sessions.id))
    .limit(filter.limit);
}

export async function cancelSessionIfScheduled(db: Db, sessionId: string): Promise<SessionRow | undefined> {
  const now = new Date();
  const [updated] = await db
    .update(sessions)
    .set({ status: CANCELLED_SESSION_STATUS, cancelledAt: now, updatedAt: now })
    .where(and(eq(sessions.id, sessionId), eq(sessions.status, SCHEDULED_SESSION_STATUS)))
    .returning();
  return updated;
}

export interface RescheduleInput {
  originalSessionId: string;
  newScheduledAt: Date;
  newDurationMinutes: number;
  createdByUserId: string;
}

/**
 * Transactionally: (a) flips the original session SCHEDULED→RESCHEDULED
 * (never deleted, all data preserved), (b) inserts exactly one replacement
 * session (origin=RESCHEDULE_REPLACEMENT, status=SCHEDULED,
 * billableForProration=true). Returns undefined if the original is not
 * currently SCHEDULED, or already has a replacement (INT-06) — both surface
 * as 409 SESSION_INVALID_STATE at the service layer. The partial UNIQUE
 * index on `rescheduled_from_session_id` is the DB-level backstop for the
 * "already has a replacement" case even under a race.
 */
export async function rescheduleSessionTransaction(
  db: Db,
  input: RescheduleInput,
): Promise<{ original: SessionRow; replacement: SessionRow } | undefined> {
  return db.transaction(async (tx) => {
    const [original] = await tx.select().from(sessions).where(eq(sessions.id, input.originalSessionId)).limit(1);
    if (!original || original.status !== SCHEDULED_SESSION_STATUS) {
      return undefined;
    }

    const existingReplacement = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.rescheduledFromSessionId, input.originalSessionId))
      .limit(1);
    if (existingReplacement.length > 0) {
      return undefined;
    }

    const now = new Date();
    const [updatedOriginal] = await tx
      .update(sessions)
      .set({ status: RESCHEDULED_SESSION_STATUS, updatedAt: now })
      .where(eq(sessions.id, original.id))
      .returning();
    if (!updatedOriginal) throw new Error("Failed to mark original session RESCHEDULED.");

    const [replacement] = await tx
      .insert(sessions)
      .values({
        workspaceId: original.workspaceId,
        groupMonthId: original.groupMonthId,
        scheduledAt: input.newScheduledAt,
        durationMinutes: input.newDurationMinutes,
        status: SCHEDULED_SESSION_STATUS,
        origin: RESCHEDULE_REPLACEMENT_ORIGIN,
        rescheduledFromSessionId: original.id,
        billableForProration: true,
        createdByUserId: input.createdByUserId,
      })
      .returning();
    if (!replacement) throw new Error("Failed to insert replacement session.");

    return { original: updatedOriginal, replacement };
  });
}

// ---------------------------------------------------------------------------
// Schedule-change apply (replace schedule_rules + reconcile future sessions)
// ---------------------------------------------------------------------------

export interface ScheduleApplyInput {
  groupMonthId: string;
  workspaceId: string;
  workspaceTimezone: string;
  targetYear: number;
  targetMonth: number;
  newRules: ScheduleRuleInput[];
  createdByUserId: string;
  now: Date;
}

export interface ScheduleApplyResult {
  cancelledSessionIds: string[];
  createdSessions: SessionRow[];
  scheduleRules: ScheduleRuleRow[];
}

/**
 * Transactionally replaces a group_month's schedule_rules with `newRules`,
 * cancels future (scheduled_at > now, status still SCHEDULED)
 * generated/manual sessions, and generates fresh SCHEDULED sessions for the
 * new rules restricted to occurrences at/after `now`. COMPLETED/IN_PROGRESS/
 * CANCELLED/RESCHEDULED sessions and any session already in the past are
 * left untouched regardless of rule changes — this function only ever
 * touches rows matching `status = SCHEDULED AND scheduled_at > now`.
 */
export async function applyScheduleChangeTransaction(
  db: Db,
  input: ScheduleApplyInput,
): Promise<ScheduleApplyResult> {
  return db.transaction(async (tx) => {
    await tx.delete(scheduleRules).where(eq(scheduleRules.groupMonthId, input.groupMonthId));

    const insertedRules: ScheduleRuleRow[] = [];
    for (const rule of input.newRules) {
      const [inserted] = await tx
        .insert(scheduleRules)
        .values({
          workspaceId: input.workspaceId,
          groupMonthId: input.groupMonthId,
          weekday: rule.weekday,
          startTime: rule.startTime,
          durationMinutes: rule.durationMinutes,
          effectiveFrom: rule.effectiveFrom ?? null,
          effectiveTo: rule.effectiveTo ?? null,
        })
        .returning();
      if (!inserted) throw new Error("Failed to insert schedule_rules row.");
      insertedRules.push(inserted);
    }

    const futureScheduled = await tx
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.groupMonthId, input.groupMonthId),
          eq(sessions.status, SCHEDULED_SESSION_STATUS),
          gt(sessions.scheduledAt, input.now),
        ),
      );

    const cancelledSessionIds: string[] = [];
    for (const session of futureScheduled) {
      await tx
        .update(sessions)
        .set({ status: CANCELLED_SESSION_STATUS, cancelledAt: input.now, updatedAt: input.now })
        .where(eq(sessions.id, session.id));
      cancelledSessionIds.push(session.id);
    }

    const occurrences = generateSessionOccurrencesForRules({
      workspaceTimezone: input.workspaceTimezone,
      year: input.targetYear,
      month: input.targetMonth,
      rules: input.newRules,
    }).filter((o) => o.scheduledAt > input.now);

    const createdSessions: SessionRow[] = [];
    for (const occurrence of occurrences) {
      const [inserted] = await tx
        .insert(sessions)
        .values({
          workspaceId: input.workspaceId,
          groupMonthId: input.groupMonthId,
          scheduledAt: occurrence.scheduledAt,
          durationMinutes: occurrence.durationMinutes,
          status: SCHEDULED_SESSION_STATUS,
          origin: GENERATED_ORIGIN,
          billableForProration: true,
          createdByUserId: input.createdByUserId,
        })
        .returning();
      if (!inserted) throw new Error("Failed to insert generated session row.");
      createdSessions.push(inserted);
    }

    return { cancelledSessionIds, createdSessions, scheduleRules: insertedRules };
  });
}

// ---------------------------------------------------------------------------
// Idempotency records
// ---------------------------------------------------------------------------

export function findIdempotencyRecord(
  db: Db,
  workspaceId: string,
  operation: string,
  key: string,
): Promise<IdempotencyRecordRow | undefined> {
  return db
    .select()
    .from(idempotencyRecords)
    .where(
      and(
        eq(idempotencyRecords.workspaceId, workspaceId),
        eq(idempotencyRecords.operation, operation),
        eq(idempotencyRecords.key, key),
      ),
    )
    .limit(1)
    .then((rows) => rows[0]);
}

/** Inserts an IN_PROGRESS idempotency record; returns undefined on a unique-constraint race (caller re-reads via findIdempotencyRecord). */
export async function tryInsertIdempotencyRecord(
  db: Db,
  input: { workspaceId: string; operation: string; key: string; requestHash: string; expiresAt: Date },
): Promise<IdempotencyRecordRow | undefined> {
  try {
    const [inserted] = await db
      .insert(idempotencyRecords)
      .values({
        workspaceId: input.workspaceId,
        operation: input.operation,
        key: input.key,
        requestHash: input.requestHash,
        status: "IN_PROGRESS",
        expiresAt: input.expiresAt,
      })
      .returning();
    return inserted;
  } catch {
    return undefined;
  }
}

export async function completeIdempotencyRecord(
  db: Db,
  id: string,
  responseCode: number,
  responsePayload: unknown,
): Promise<void> {
  await db
    .update(idempotencyRecords)
    .set({ status: "COMPLETED", responseCode, responsePayload, updatedAt: new Date() })
    .where(eq(idempotencyRecords.id, id));
}

export async function failIdempotencyRecord(db: Db, id: string): Promise<void> {
  await db
    .update(idempotencyRecords)
    .set({ status: "FAILED_RETRYABLE", updatedAt: new Date() })
    .where(eq(idempotencyRecords.id, id));
}

// ---------------------------------------------------------------------------
// CreateMonth transaction
// ---------------------------------------------------------------------------

export interface CreateMonthGroupSpec {
  groupId: string;
  locationId: string | null;
  baseFeeMinor: number;
  currencyCode: string;
  duePolicy: string;
  dueDay: number | null;
  joinFeePolicy: string;
  scheduleRules: ScheduleRuleInput[];
}

export interface CreateMonthTransactionInput {
  workspaceId: string;
  workspaceTimezone: string;
  targetYear: number;
  targetMonth: number;
  createdByUserId: string;
  groupSpecs: CreateMonthGroupSpec[];
}

export interface CreateMonthTransactionResult {
  operatingMonth: OperatingMonthRow;
  groupMonths: GroupMonthRow[];
  sessionCount: number;
}

/**
 * The CreateMonth / Carry-Forward transaction (Database Schema §17.3 steps
 * 1-4, 7-9 — steps 5-6, Enrollments/FinancialObligations, are out of Phase 3
 * scope per the pre-authorized scoping decision). Re-validates no duplicate
 * (workspace, year, month) INSIDE the transaction (defense against a race
 * between preview and confirm), archives the previous CURRENT month (if
 * any) to preserve INT-01, creates the OperatingMonth as CURRENT, creates
 * one GroupMonth + its schedule_rules per group spec, and generates
 * SCHEDULED sessions from those rules. No OutboxEvent step — no
 * `outbox_events` table exists yet (documented Phase 3 deviation).
 */
export async function runCreateMonthTransaction(
  db: Db,
  input: CreateMonthTransactionInput,
): Promise<CreateMonthTransactionResult | "MONTH_ALREADY_EXISTS"> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(operatingMonths)
      .where(
        and(
          eq(operatingMonths.workspaceId, input.workspaceId),
          eq(operatingMonths.year, input.targetYear),
          eq(operatingMonths.month, input.targetMonth),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      return "MONTH_ALREADY_EXISTS" as const;
    }

    const [previousCurrent] = await tx
      .select()
      .from(operatingMonths)
      .where(and(eq(operatingMonths.workspaceId, input.workspaceId), eq(operatingMonths.status, CURRENT_MONTH_STATUS)))
      .limit(1);
    if (previousCurrent) {
      await tx
        .update(operatingMonths)
        .set({ status: ARCHIVED_MONTH_STATUS, archivedAt: new Date() })
        .where(eq(operatingMonths.id, previousCurrent.id));
    }

    const [operatingMonth] = await tx
      .insert(operatingMonths)
      .values({
        workspaceId: input.workspaceId,
        year: input.targetYear,
        month: input.targetMonth,
        status: CURRENT_MONTH_STATUS,
        createdByUserId: input.createdByUserId,
        activatedAt: new Date(),
      })
      .returning();
    if (!operatingMonth) throw new Error("Failed to insert operating_months row.");

    const createdGroupMonths: GroupMonthRow[] = [];
    let sessionCount = 0;

    for (const spec of input.groupSpecs) {
      const [groupMonth] = await tx
        .insert(groupMonths)
        .values({
          workspaceId: input.workspaceId,
          groupId: spec.groupId,
          operatingMonthId: operatingMonth.id,
          locationId: spec.locationId,
          baseFeeMinor: spec.baseFeeMinor,
          currencyCode: spec.currencyCode,
          duePolicy: spec.duePolicy,
          dueDay: spec.dueDay,
          joinFeePolicy: spec.joinFeePolicy,
        })
        .returning();
      if (!groupMonth) throw new Error("Failed to insert group_months row.");
      createdGroupMonths.push(groupMonth);

      for (const rule of spec.scheduleRules) {
        await tx.insert(scheduleRules).values({
          workspaceId: input.workspaceId,
          groupMonthId: groupMonth.id,
          weekday: rule.weekday,
          startTime: rule.startTime,
          durationMinutes: rule.durationMinutes,
          effectiveFrom: rule.effectiveFrom ?? null,
          effectiveTo: rule.effectiveTo ?? null,
        });
      }

      const occurrences = generateSessionOccurrencesForRules({
        workspaceTimezone: input.workspaceTimezone,
        year: input.targetYear,
        month: input.targetMonth,
        rules: spec.scheduleRules,
      });

      for (const occurrence of occurrences) {
        await tx.insert(sessions).values({
          workspaceId: input.workspaceId,
          groupMonthId: groupMonth.id,
          scheduledAt: occurrence.scheduledAt,
          durationMinutes: occurrence.durationMinutes,
          status: SCHEDULED_SESSION_STATUS,
          origin: GENERATED_ORIGIN,
          billableForProration: true,
          createdByUserId: input.createdByUserId,
        });
        sessionCount += 1;
      }
    }

    return { operatingMonth, groupMonths: createdGroupMonths, sessionCount };
  });
}

export interface SchedulingAuditEventInput {
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

export async function insertSchedulingAuditEvent(db: Db, input: SchedulingAuditEventInput): Promise<void> {
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
