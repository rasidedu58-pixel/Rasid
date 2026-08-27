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
import { and, asc, desc, eq, gt, gte, inArray, lte, sql as rawSql } from "drizzle-orm";
import { groupMonths, groups, scheduleRules } from "../schema/groups";
import { locations, operatingMonths } from "../schema/months";
import { sessions } from "../schema/sessions";
import { idempotencyRecords } from "../schema/idempotency";
import { auditEvents } from "../schema/audit";
import { workspaces } from "../schema/workspaces";
import { enrollments } from "../schema/enrollments";
import { financialObligations } from "../schema/finance";
import { outboxEvents } from "../schema/outbox";
// `WorkspaceRow` is already exported by identity.repository.ts (same
// underlying `workspaces` table) — re-used here (not redeclared) to avoid
// a duplicate-export name collision at the package barrel.
import type { Db, WorkspaceRow } from "./identity.repository";
import { upsertObligationForEnrollment } from "./finance.repository";
import { computeObligationDueDate } from "../finance/due-date";
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

/**
 * Phase 15D.1 — batched counterpart of {@link findGroupById} for the "do all
 * these group ids belong to this workspace?" check. Team grant-replace used
 * to call `findGroupById` once PER group id in the payload (one RLS
 * transaction each — a genuine per-item N+1); this returns, in ONE query, the
 * subset of `groupIds` that actually exist in `workspaceId`. The caller
 * treats any requested id NOT in the returned set as out-of-workspace (the
 * same rejection as before). Empty input ⇒ no query. Note: this is a direct
 * SQL `IN (...)` via postgres.js (NOT PostgREST), so it is not subject to the
 * REST `.in()` URL-length limit — a team's group count is small regardless.
 */
export async function findGroupIdsInWorkspace(db: Db, groupIds: string[], workspaceId: string): Promise<string[]> {
  if (groupIds.length === 0) return [];
  const rows = await db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.workspaceId, workspaceId), inArray(groups.id, groupIds)));
  return rows.map((r) => r.id);
}

export function listGroupsForWorkspace(db: Db, workspaceId: string): Promise<GroupRow[]> {
  // Phase 15: deterministic ordering — without it the groups screen
  // reshuffled between reloads (heap order is not stable).
  return db.select().from(groups).where(eq(groups.workspaceId, workspaceId)).orderBy(asc(groups.name), asc(groups.id));
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
  // Phase 15: deterministic ordering (workspace scoping comes via RLS's
  // own `workspace_id = current_setting(...)` predicate, which also lets
  // the planner use the workspace-leading composite index).
  return db.select().from(groupMonths).where(eq(groupMonths.operatingMonthId, operatingMonthId)).orderBy(asc(groupMonths.id));
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
  /**
   * Set only when this group is being carried forward from a prior
   * OperatingMonth (Phase 6 Closure Delta). When present, the transaction
   * carries every ACTIVE enrollment of this source GroupMonth into a brand
   * new Enrollment (new id, same Student) + FinancialObligation under the
   * newly-created GroupMonth. Absent for a fresh group with no prior month
   * to carry from (`selectedGroupIds` preview path).
   */
  sourceGroupMonthId?: string;
}

export interface CreateMonthTransactionInput {
  workspaceId: string;
  workspaceTimezone: string;
  targetYear: number;
  targetMonth: number;
  createdByUserId: string;
  createdByMembershipId: string | null;
  correlationId?: string | null;
  groupSpecs: CreateMonthGroupSpec[];
}

export interface CreateMonthTransactionResult {
  operatingMonth: OperatingMonthRow;
  groupMonths: GroupMonthRow[];
  sessionCount: number;
  /** Count of brand-new Enrollment rows created by carrying forward continuing students (Phase 6 Closure Delta). Zero for group specs with no `sourceGroupMonthId`. */
  enrollmentCount: number;
}

export const CARRY_FORWARD_DUE_DAY_UNRESOLVED = "CARRY_FORWARD_DUE_DAY_UNRESOLVED" as const;

/**
 * Thrown INSIDE the transaction to force a full rollback ("no half-created
 * month") when a carried-forward group's due day cannot be resolved.
 * Caught by `runCreateMonthTransaction`'s own try/catch (mirrors
 * `session-mode.repository.ts`'s marker-error convention) and converted to
 * a sentinel string return value — never surfaces as a raw 500.
 */
class CarryForwardDueDayUnresolvedMarker extends Error {
  constructor(public readonly groupId: string) {
    super(CARRY_FORWARD_DUE_DAY_UNRESOLVED);
  }
}

/**
 * The CreateMonth / Carry-Forward transaction — Database Schema §17.3 steps
 * 1-9, now fully implemented (Phase 6 Closure Delta closes steps 5-6,
 * Enrollments/FinancialObligations, and the Outbox step, both previously
 * documented as deferred). Re-validates no duplicate (workspace, year,
 * month) INSIDE the transaction (defense against a race between preview
 * and confirm), archives the previous CURRENT month (if any) to preserve
 * INT-01, creates the OperatingMonth as CURRENT, creates one GroupMonth +
 * its schedule_rules per group spec, generates SCHEDULED sessions from
 * those rules, and — for every group spec carrying a `sourceGroupMonthId`
 * — carries forward its ACTIVE enrollments:
 *
 * - Continuing = `enrollment.status === "ACTIVE"` in the source GroupMonth
 *   only (the only status literally meaning "currently enrolled"); no doc
 *   defines this classification explicitly, so this is the minimal,
 *   non-invented reading — WITHDRAWN/STOPPED/TRANSFERRED/PENDING are never
 *   carried.
 * - Each continuing student gets a brand-new Enrollment row (new id, same
 *   student_id, new group_month_id, join_date = the new month's first
 *   calendar day, status ACTIVE, fee_method FULL_MONTH) — never a reused or
 *   reactivated enrollment id.
 * - Fee rule (Product Decision — Carry-Forward Fee Rule): a carry-forward
 *   Enrollment is, by definition, an enrollment from the FIRST DAY of the
 *   new month — never a mid-month join. `join_fee_policy`
 *   (FULL/REMAINING/ASK_EVERY_TIME) governs an ACTUAL mid-month join
 *   decision and simply does not apply here. Every continuing enrollment
 *   therefore gets a FinancialObligation for the GroupMonth's full monthly
 *   fee (`baseFeeMinor`, calculationBasis `FULL_MONTH`), regardless of the
 *   group's `join_fee_policy` value — INCLUDING `ASK_EVERY_TIME`, which
 *   never blocks or asks anything on this path. No proration engine is
 *   ever invoked for carry-forward.
 * - The new FinancialObligation is created via the SAME
 *   `upsertObligationForEnrollment` used by manual Enrollment create/
 *   transfer, inside this SAME `tx` — amount_paid always starts at 0,
 *   remaining = full net_due; prior Payments/Reversals never transfer
 *   (impossible anyway — the Enrollment id is new). Old (prior-month) debt
 *   is left as an independent, untouched historical obligation — no
 *   auto-allocation.
 * - Attendance/Homework/Exams/Session records/Payments/Reversals are never
 *   copied — nothing in this function reads or writes those tables.
 *
 * AuditEvent(month.created) + OutboxEvent(MonthCreated) are inserted INSIDE
 * this same transaction (moved here from the app layer in the Closure
 * Delta), matching the `recordPaymentTransaction`/`reversePaymentTransaction`
 * convention exactly.
 */
export async function runCreateMonthTransaction(
  db: Db,
  input: CreateMonthTransactionInput,
): Promise<CreateMonthTransactionResult | "MONTH_ALREADY_EXISTS" | typeof CARRY_FORWARD_DUE_DAY_UNRESOLVED> {
  try {
    return await runCreateMonthTransactionInner(db, input);
  } catch (err) {
    if (err instanceof CarryForwardDueDayUnresolvedMarker) return CARRY_FORWARD_DUE_DAY_UNRESOLVED;
    throw err;
  }
}

async function runCreateMonthTransactionInner(
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
    let enrollmentCount = 0;

    // Only fetched if at least one group spec carries forward — the
    // workspace's `unifiedDueDay` fallback (same specificity-priority
    // FinanceService's `resolveObligationTerms` already uses for manual
    // enrollments: `groupMonth.dueDay ?? workspace.unifiedDueDay`).
    let workspaceRow: WorkspaceRow | undefined;
    if (input.groupSpecs.some((s) => s.sourceGroupMonthId)) {
      const rows = await tx.select().from(workspaces).where(eq(workspaces.id, input.workspaceId)).limit(1);
      workspaceRow = rows[0];
    }

    const firstOfMonthIso = `${input.targetYear}-${String(input.targetMonth).padStart(2, "0")}-01`;

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

      if (spec.sourceGroupMonthId) {
        const sourceEnrollments = await tx
          .select()
          .from(enrollments)
          .where(and(eq(enrollments.groupMonthId, spec.sourceGroupMonthId), eq(enrollments.status, "ACTIVE")));

        // `join_fee_policy` (including ASK_EVERY_TIME) governs an ACTUAL
        // mid-month join decision and does not apply to carry-forward — a
        // continuing enrollment is, by definition, effective from day 1 of
        // the new month, so it always gets the full monthly fee regardless
        // of the group's join_fee_policy value (Product Decision —
        // Carry-Forward Fee Rule).

        const dueDay = spec.dueDay ?? workspaceRow?.unifiedDueDay ?? null;

        for (const source of sourceEnrollments) {
          if (dueDay === null) {
            throw new CarryForwardDueDayUnresolvedMarker(spec.groupId);
          }
          const dueDate = computeObligationDueDate({
            year: input.targetYear,
            month: input.targetMonth,
            dueDay,
            workspaceTimezone: input.workspaceTimezone,
          });

          const [newEnrollment] = await tx
            .insert(enrollments)
            .values({
              workspaceId: input.workspaceId,
              studentId: source.studentId,
              groupMonthId: groupMonth.id,
              joinDate: firstOfMonthIso,
              status: "ACTIVE",
              feeMethod: "FULL_MONTH",
              customFeeMinor: null,
            })
            .returning();
          if (!newEnrollment) throw new Error("Failed to insert carried-forward enrollments row.");
          enrollmentCount += 1;

          await upsertObligationForEnrollment(tx, {
            workspaceId: input.workspaceId,
            enrollmentId: newEnrollment.id,
            baseFeeMinor: spec.baseFeeMinor,
            currencyCode: spec.currencyCode,
            dueDate,
            calculationBasis: "FULL_MONTH",
            calculationSnapshotJson: {
              source: "CARRY_FORWARD",
              sourceEnrollmentId: source.id,
              sourceGroupMonthId: spec.sourceGroupMonthId,
              joinFeePolicy: spec.joinFeePolicy,
            },
          });
        }
      }
    }

    await tx.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.createdByUserId,
      actorMembershipId: input.createdByMembershipId,
      action: "month.created",
      entityType: "operating_month",
      entityId: operatingMonth.id,
      afterJson: {
        operatingMonthId: operatingMonth.id,
        groupMonthCount: createdGroupMonths.length,
        sessionCount,
        enrollmentCount,
      },
      correlationId: input.correlationId ?? null,
    });

    await tx.insert(outboxEvents).values({
      workspaceId: input.workspaceId,
      eventType: "MonthCreated",
      aggregateType: "OperatingMonth",
      aggregateId: operatingMonth.id,
      payload: {
        operatingMonthId: operatingMonth.id,
        year: input.targetYear,
        month: input.targetMonth,
        groupMonthCount: createdGroupMonths.length,
        sessionCount,
        enrollmentCount,
      },
    });

    return { operatingMonth, groupMonths: createdGroupMonths, sessionCount, enrollmentCount };
  });
}

// ---------------------------------------------------------------------------
// Carry-Forward preview stats (Phase 6 Closure Delta) — read-only, used by
// `previewCreateMonth` to populate API Contract §11.3's `students`/
// `newObligationsTotalMinor`/`studentsWithOldDebt` fields, deliberately
// omitted until now (Phase 3 pre-authorized scoping decision #3).
// ---------------------------------------------------------------------------

export interface CarryForwardStats {
  continuing: number;
  excluded: number;
  transferred: number;
  continuingStudentIds: string[];
}

/** Classifies a source GroupMonth's enrollments for carry-forward preview: continuing = ACTIVE only, transferred = TRANSFERRED, excluded = everything else (PENDING/STOPPED/WITHDRAWN). */
export async function getCarryForwardStats(db: Db, sourceGroupMonthId: string): Promise<CarryForwardStats> {
  const rows = await db
    .select({ status: enrollments.status, studentId: enrollments.studentId })
    .from(enrollments)
    .where(eq(enrollments.groupMonthId, sourceGroupMonthId));

  const stats: CarryForwardStats = { continuing: 0, excluded: 0, transferred: 0, continuingStudentIds: [] };
  for (const row of rows) {
    if (row.status === "ACTIVE") {
      stats.continuing += 1;
      stats.continuingStudentIds.push(row.studentId);
    } else if (row.status === "TRANSFERRED") {
      stats.transferred += 1;
    } else {
      stats.excluded += 1;
    }
  }
  return stats;
}

/** Count of `studentIds` with at least one prior obligation still owing (remaining > 0) — old debt is independent of carry-forward eligibility (never blocks, never auto-allocated), this is purely informational for the preview. */
export async function countStudentsWithOldDebt(db: Db, workspaceId: string, studentIds: string[]): Promise<number> {
  if (studentIds.length === 0) return 0;
  const rows = await db
    .selectDistinct({ studentId: enrollments.studentId })
    .from(financialObligations)
    .innerJoin(enrollments, eq(enrollments.id, financialObligations.enrollmentId))
    .where(
      and(
        eq(financialObligations.workspaceId, workspaceId),
        inArray(enrollments.studentId, studentIds),
        gt(financialObligations.remainingMinor, 0),
      ),
    );
  return rows.length;
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
