/**
 * Action Center-specific read queries — Phase 9. Kept separate from
 * `reports.repository.ts` (different endpoint, different consumer) but
 * follows the exact same "PostgreSQL first, no dedicated read model"
 * philosophy (ADR-020), and reuses `deriveMissingRecords`/
 * `deriveEligibleEnrollmentIds` — the SAME Phase 5 source of truth
 * `notifications-scan.ts`/`session-mode.service.ts` already use (Phase 9
 * Closure correction #2 — never a divergent "session overdue" definition).
 */
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { groupMonths, groups } from "../schema/groups";
import { enrollments } from "../schema/enrollments";
import { sessions } from "../schema/sessions";
import { sessionRecords } from "../schema/session-records";
import { students } from "../schema/students";
import { operatingMonths } from "../schema/months";
import { workspaces } from "../schema/workspaces";
import { deriveEligibleEnrollmentIds } from "../session-mode/roster";
import { deriveMissingRecords } from "../session-mode/missing-records";
import type { Db } from "../repositories/identity.repository";
import { listAttentionCasesForWorkspace, listScheduledFollowups, type AttentionCaseRow, type ScheduledFollowupRow } from "../repositories/attention.repository";
import { listCollectionQueue, type CollectionQueueRow } from "../repositories/finance.repository";
import { findSubscriptionByWorkspaceId, type SubscriptionRow } from "../repositories/subscriptions.repository";

export interface CurrentMonthRef {
  id: string;
  year: number;
  month: number;
}

export async function getCurrentMonth(db: Db, workspaceId: string): Promise<CurrentMonthRef | undefined> {
  const [row] = await db
    .select({ id: operatingMonths.id, year: operatingMonths.year, month: operatingMonths.month })
    .from(operatingMonths)
    .where(and(eq(operatingMonths.workspaceId, workspaceId), eq(operatingMonths.status, "CURRENT")))
    .limit(1);
  return row;
}

export interface MissingRecordsSessionItem {
  sessionId: string;
  groupId: string;
  groupName: string;
  missingCount: number;
}

/**
 * IN_PROGRESS sessions in the CURRENT operating month, restricted to
 * `visibleGroupIds` ("ALL" or an explicit set), that genuinely have a
 * missing-records gap.
 *
 * `currentMonthId` (Phase 15C) lets a caller that already resolved the
 * CURRENT month (the Action Center does) thread it in, avoiding a duplicate
 * `operating_months` lookup. When omitted, behaviour is unchanged.
 */
export async function listSessionsWithMissingRecords(db: Db, workspaceId: string, visibleGroupIds: "ALL" | string[], limit: number, currentMonthId?: string): Promise<MissingRecordsSessionItem[]> {
  let resolvedMonthId = currentMonthId;
  if (resolvedMonthId === undefined) {
    const [currentMonth] = await db.select({ id: operatingMonths.id }).from(operatingMonths).where(and(eq(operatingMonths.workspaceId, workspaceId), eq(operatingMonths.status, "CURRENT"))).limit(1);
    if (!currentMonth) return [];
    resolvedMonthId = currentMonth.id;
  }

  const [workspace] = await db.select({ timezone: workspaces.timezone }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  const workspaceTimezone = workspace?.timezone ?? "Africa/Cairo";

  let groupMonthRows = await db
    .select({ id: groupMonths.id, groupId: groupMonths.groupId, groupName: groups.name })
    .from(groupMonths)
    .innerJoin(groups, eq(groups.id, groupMonths.groupId))
    .where(and(eq(groupMonths.workspaceId, workspaceId), eq(groupMonths.operatingMonthId, resolvedMonthId)));
  if (visibleGroupIds !== "ALL") {
    const visibleSet = new Set(visibleGroupIds);
    groupMonthRows = groupMonthRows.filter((gm) => visibleSet.has(gm.groupId));
  }
  if (groupMonthRows.length === 0) return [];
  const groupMonthById = new Map(groupMonthRows.map((gm) => [gm.id, gm]));

  const inProgressSessions = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.workspaceId, workspaceId), eq(sessions.status, "IN_PROGRESS"), inArray(sessions.groupMonthId, [...groupMonthById.keys()])));
  if (inProgressSessions.length === 0) return [];

  const groupMonthIds = [...new Set(inProgressSessions.map((s) => s.groupMonthId))];
  const enrollmentRows = await db
    .select({ id: enrollments.id, groupMonthId: enrollments.groupMonthId, studentId: enrollments.studentId, joinDate: enrollments.joinDate, endedAt: enrollments.endedAt })
    .from(enrollments)
    .where(inArray(enrollments.groupMonthId, groupMonthIds));
  const enrollmentsByGroupMonth = new Map<string, typeof enrollmentRows>();
  for (const e of enrollmentRows) {
    const list = enrollmentsByGroupMonth.get(e.groupMonthId) ?? [];
    list.push(e);
    enrollmentsByGroupMonth.set(e.groupMonthId, list);
  }

  const studentRows = enrollmentRows.length
    ? await db.select({ id: students.id, name: students.name }).from(students).where(inArray(students.id, enrollmentRows.map((e) => e.studentId)))
    : [];
  const studentNameById = new Map(studentRows.map((s) => [s.id, s.name]));

  const sessionIds = inProgressSessions.map((s) => s.id);
  const records = await db.select().from(sessionRecords).where(inArray(sessionRecords.sessionId, sessionIds));
  const recordsBySession = new Map<string, typeof records>();
  for (const r of records) {
    const list = recordsBySession.get(r.sessionId) ?? [];
    list.push(r);
    recordsBySession.set(r.sessionId, list);
  }

  const results: MissingRecordsSessionItem[] = [];
  for (const session of inProgressSessions) {
    const groupEnrollments = enrollmentsByGroupMonth.get(session.groupMonthId) ?? [];
    const eligibleEnrollmentIds = deriveEligibleEnrollmentIds({
      enrollments: groupEnrollments.map((e) => ({ enrollmentId: e.id, joinDate: e.joinDate, endedAt: e.endedAt })),
      sessionScheduledAt: session.scheduledAt,
      workspaceTimezone,
    });
    const recordsByEnrollmentId = new Map((recordsBySession.get(session.id) ?? []).map((r) => [r.enrollmentId, r]));
    const studentNameByEnrollmentId = new Map(groupEnrollments.map((e) => [e.id, studentNameById.get(e.studentId) ?? ""]));
    const { missingRecords } = deriveMissingRecords({ eligibleEnrollmentIds, recordsByEnrollmentId, studentNameByEnrollmentId });
    if (missingRecords.length === 0) continue;
    const gm = groupMonthById.get(session.groupMonthId);
    if (!gm) continue;
    results.push({ sessionId: session.id, groupId: gm.groupId, groupName: gm.groupName, missingCount: missingRecords.length });
    if (results.length >= limit) break;
  }
  return results;
}

export interface NextSessionItem {
  sessionId: string;
  groupName: string;
  scheduledAt: Date;
}

/** The single soonest-upcoming SCHEDULED session (now or later), restricted to `visibleGroupIds`. */
export async function getNextSession(db: Db, workspaceId: string, visibleGroupIds: "ALL" | string[], now: Date): Promise<NextSessionItem | undefined> {
  let groupMonthRows = await db
    .select({ id: groupMonths.id, groupId: groupMonths.groupId })
    .from(groupMonths)
    .where(eq(groupMonths.workspaceId, workspaceId));
  if (visibleGroupIds !== "ALL") {
    const visibleSet = new Set(visibleGroupIds);
    groupMonthRows = groupMonthRows.filter((gm) => visibleSet.has(gm.groupId));
  }
  if (groupMonthRows.length === 0) return undefined;

  const [row] = await db
    .select({ id: sessions.id, scheduledAt: sessions.scheduledAt, groupName: groups.name })
    .from(sessions)
    .innerJoin(groupMonths, eq(groupMonths.id, sessions.groupMonthId))
    .innerJoin(groups, eq(groups.id, groupMonths.groupId))
    .where(and(eq(sessions.workspaceId, workspaceId), eq(sessions.status, "SCHEDULED"), gt(sessions.scheduledAt, now), inArray(sessions.groupMonthId, groupMonthRows.map((gm) => gm.id))))
    .orderBy(asc(sessions.scheduledAt))
    .limit(1);
  if (!row) return undefined;
  return { sessionId: row.id, groupName: row.groupName, scheduledAt: row.scheduledAt };
}

// ---------------------------------------------------------------------------
// Phase 15C — combined Action Center loader.
//
// The dashboard's `GET /action-center` used to open SEVEN separate
// `withRuntimeContext` transactions (one per section) to return a tiny
// response — measured ~9.5 DB transactions/request. This runs every
// still-needed section's SAME query, in dependency order, inside ONE
// transaction (one BEGIN/set_config/COMMIT on one connection). No query
// logic or filtering changes — the service still gates each section by
// permission (a section it omits is simply not requested here) and applies
// its own JS post-filters. `month` is fetched once and threaded into the
// missing-records query so it is not re-looked-up.
// ---------------------------------------------------------------------------

export interface ActionCenterDataParams {
  workspaceId: string;
  now: Date;
  limit: number;
  /** Each optional section: present ⇒ fetch it with this scope; absent ⇒ the caller lacks permission, skip it entirely. */
  attention?: { restrictToGroupIds: string[] | undefined };
  followups?: { restrictToGroupIds: string[] | undefined };
  missing?: { visibleGroupIds: "ALL" | string[] };
  collection?: { restrictToGroupIds: string[] | undefined };
  subscription?: boolean;
  /** next-session is shown to any active member (scoped to their visible groups); always requested. */
  nextSession: { visibleGroupIds: "ALL" | string[] };
}

export interface ActionCenterData {
  month: CurrentMonthRef | undefined;
  attentionCases: AttentionCaseRow[] | undefined;
  followups: ScheduledFollowupRow[] | undefined;
  missingRecords: MissingRecordsSessionItem[] | undefined;
  collection: CollectionQueueRow[] | undefined;
  subscription: SubscriptionRow | undefined;
  nextSession: NextSessionItem | undefined;
}

export async function loadActionCenterData(db: Db, p: ActionCenterDataParams): Promise<ActionCenterData> {
  // The CURRENT month is needed by the missing-records query, so resolve it
  // first; every other section is independent and is issued concurrently on
  // this ONE transaction's connection (postgres.js pipelines them — so this
  // keeps the single-transaction win of ~7→1 while recovering the
  // parallelism the seven separate transactions used to have).
  const month = await getCurrentMonth(db, p.workspaceId);
  const [attentionCases, followups, missingRecords, collection, subscription, nextSession] = await Promise.all([
    p.attention
      ? listAttentionCasesForWorkspace(db, { workspaceId: p.workspaceId, restrictToGroupIds: p.attention.restrictToGroupIds, limit: p.limit })
      : Promise.resolve(undefined),
    p.followups
      ? listScheduledFollowups(db, { workspaceId: p.workspaceId, status: "PENDING", restrictToGroupIds: p.followups.restrictToGroupIds, limit: p.limit })
      : Promise.resolve(undefined),
    p.missing
      ? listSessionsWithMissingRecords(db, p.workspaceId, p.missing.visibleGroupIds, p.limit, month?.id)
      : Promise.resolve(undefined),
    p.collection
      ? listCollectionQueue(db, { workspaceId: p.workspaceId, restrictToGroupIds: p.collection.restrictToGroupIds, limit: p.limit })
      : Promise.resolve(undefined),
    p.subscription ? findSubscriptionByWorkspaceId(db, p.workspaceId) : Promise.resolve(undefined),
    getNextSession(db, p.workspaceId, p.nextSession.visibleGroupIds, p.now),
  ]);
  return { month, attentionCases, followups, missingRecords, collection, subscription, nextSession };
}
