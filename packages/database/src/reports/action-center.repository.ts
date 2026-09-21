/**
 * Action Center-specific read queries — Phase 9. Kept separate from
 * `reports.repository.ts` (different endpoint, different consumer) but
 * follows the exact same "PostgreSQL first, no dedicated read model"
 * philosophy (ADR-020), and reuses `deriveMissingRecords`/
 * `deriveEligibleEnrollmentIds` — the SAME Phase 5 source of truth
 * `notifications-scan.ts`/`session-mode.service.ts` already use (Phase 9
 * Closure correction #2 — never a divergent "session overdue" definition).
 */
import { and, asc, desc, eq, gt, inArray, lte, or, sql } from "drizzle-orm";
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
import { listAttentionCasesForWorkspace, listAttentionEvidenceForReasons, listAttentionReasonsForCases, listScheduledFollowups, type AttentionCaseRow, type AttentionEvidenceRow, type AttentionReasonRow, type ScheduledFollowupRow } from "../repositories/attention.repository";
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
 * Fragment used by both the "current session" and "missed session" queries —
 * a Postgres `interval` value derived from the row's `duration_minutes`.
 * Kept as `sql` so `endAt = scheduledAt + duration` becomes a single index-
 * friendly comparison rather than a per-row JS calculation on every read.
 * Owner directive (Phase 3, rule 2): the endAt boundary is EXACT — a
 * session leaves the "ongoing now" set the instant `now >= endAt`, with no
 * grace period.
 */
const durationInterval = sql`(${sessions.durationMinutes} * interval '1 minute')`;

/**
 * Wrap a JS `Date` as an explicit `timestamptz` on the SQL side.
 *
 * `postgres.js` cannot safely infer the wire type of a bare `Date` param
 * whose SQL slot is a raw `sql\`\`` expression (`scheduledAt + duration_minutes
 * * interval '1 minute'`) — drizzle only attaches a column-type hint when
 * one side of the comparison is a real column, not a computed expression.
 * Without the hint, postgres.js threw `ERR_INVALID_ARG_TYPE` for every
 * `/action-center` request on the deployed API. Passing the ISO string
 * with an explicit `::timestamptz` cast side-steps the type inference
 * entirely — postgres.js just sees a plain string, and Postgres itself
 * does the timestamp coercion server-side.
 */
function asTimestamptz(now: Date) {
  return sql`${now.toISOString()}::timestamptz`;
}

/**
 * IN_PROGRESS sessions in the CURRENT operating month, restricted to
 * `visibleGroupIds` ("ALL" or an explicit set), that genuinely have a
 * missing-records gap AND whose scheduled window has NOT yet ended.
 *
 * A past-slot IN_PROGRESS row is deliberately excluded here — those are
 * surfaced under `listMissedSessions` with the «فائتة — لم تُسجَّل» label
 * so the same session never appears in two buckets at once.
 *
 * `currentMonthId` (Phase 15C) lets a caller that already resolved the
 * CURRENT month (the Action Center does) thread it in, avoiding a duplicate
 * `operating_months` lookup. When omitted, behaviour is unchanged.
 */
export async function listSessionsWithMissingRecords(db: Db, workspaceId: string, visibleGroupIds: "ALL" | string[], limit: number, currentMonthId?: string, now: Date = new Date()): Promise<MissingRecordsSessionItem[]> {
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
    .where(
      and(
        eq(sessions.workspaceId, workspaceId),
        eq(sessions.status, "IN_PROGRESS"),
        // Owner directive: a past-slot IN_PROGRESS row is a MISSED session,
        // not a still-in-progress one — leave it for `listMissedSessions`.
        gt(sql`${sessions.scheduledAt} + ${durationInterval}`, asTimestamptz(now)),
        inArray(sessions.groupMonthId, [...groupMonthById.keys()]),
      ),
    );
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
  /** Carried through so the client can compute `endAt = scheduledAt + durationMinutes` for boundary-scheduled invalidation without a second query. */
  durationMinutes: number;
  /**
   * DISPLAY status derived from `sessions.status` combined with the row's
   * time window vs `now` — see `packages/contracts/src/reports.ts` for
   * the full contract. `IN_PROGRESS` and `READY` are both "live-now"
   * states, `SCHEDULED` is a future session. A past-slot IN_PROGRESS row
   * never surfaces here — it is a missed session (see `listMissedSessions`).
   */
  status: "SCHEDULED" | "READY" | "IN_PROGRESS";
}

/**
 * The single session to surface on the dashboard's "current / next" card.
 *
 * Selection precedence (owner directive, Phase 3–5):
 *   1. Live IN_PROGRESS whose window covers `now` (`scheduledAt <= now <
 *      scheduledAt + durationMinutes`, NO grace period). If more than one
 *      is live simultaneously, the earliest starting wins.
 *   2. Otherwise, a SCHEDULED session whose window covers `now` — the slot
 *      has arrived but the teacher hasn't tapped Start yet. Surfaced with
 *      `status='READY'` so the dashboard can invite «حان موعدها — ابدأ
 *      الحصة».
 *   3. Otherwise, the soonest upcoming SCHEDULED session (`scheduledAt >
 *      now`).
 *
 * A stored IN_PROGRESS row whose slot ended in the past never blocks the
 * dashboard: it is out of every branch here and surfaces separately under
 * `listMissedSessions`. This closes the production bug where a Monday
 * session with a hung `IN_PROGRESS` was billed as "the current session"
 * on Wednesday and masked the actual Wednesday slot.
 *
 * `sessions.status` is NOT mutated by this query — the classification is
 * pure derivation. Scoped to `visibleGroupIds`.
 */
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
  const visibleGroupMonthIds = groupMonthRows.map((gm) => gm.id);

  // (1) A LIVE session — the teacher started it and the slot still covers now.
  //     Ordering by asc(scheduledAt) so the earliest still-live session wins
  //     if two happen to overlap.
  const [current] = await db
    .select({ id: sessions.id, scheduledAt: sessions.scheduledAt, durationMinutes: sessions.durationMinutes, groupName: groups.name })
    .from(sessions)
    .innerJoin(groupMonths, eq(groupMonths.id, sessions.groupMonthId))
    .innerJoin(groups, eq(groups.id, groupMonths.groupId))
    .where(
      and(
        eq(sessions.workspaceId, workspaceId),
        eq(sessions.status, "IN_PROGRESS"),
        lte(sessions.scheduledAt, now),
        gt(sql`${sessions.scheduledAt} + ${durationInterval}`, asTimestamptz(now)),
        inArray(sessions.groupMonthId, visibleGroupMonthIds),
      ),
    )
    .orderBy(asc(sessions.scheduledAt))
    .limit(1);
  if (current) return { sessionId: current.id, groupName: current.groupName, scheduledAt: current.scheduledAt, durationMinutes: current.durationMinutes, status: "IN_PROGRESS" };

  // (2) A SCHEDULED session whose slot has ARRIVED but hasn't been started.
  //     Surfaced as READY so the dashboard shows «حان موعدها — ابدأ الحصة»
  //     independently of a plain future upcoming session, per the owner's
  //     directive that a session ready-to-start must not get lost between
  //     "current" and "upcoming".
  const [ready] = await db
    .select({ id: sessions.id, scheduledAt: sessions.scheduledAt, durationMinutes: sessions.durationMinutes, groupName: groups.name })
    .from(sessions)
    .innerJoin(groupMonths, eq(groupMonths.id, sessions.groupMonthId))
    .innerJoin(groups, eq(groups.id, groupMonths.groupId))
    .where(
      and(
        eq(sessions.workspaceId, workspaceId),
        eq(sessions.status, "SCHEDULED"),
        lte(sessions.scheduledAt, now),
        gt(sql`${sessions.scheduledAt} + ${durationInterval}`, asTimestamptz(now)),
        inArray(sessions.groupMonthId, visibleGroupMonthIds),
      ),
    )
    .orderBy(asc(sessions.scheduledAt))
    .limit(1);
  if (ready) return { sessionId: ready.id, groupName: ready.groupName, scheduledAt: ready.scheduledAt, durationMinutes: ready.durationMinutes, status: "READY" };

  // (3) The soonest genuinely-future scheduled session.
  const [row] = await db
    .select({ id: sessions.id, scheduledAt: sessions.scheduledAt, durationMinutes: sessions.durationMinutes, groupName: groups.name })
    .from(sessions)
    .innerJoin(groupMonths, eq(groupMonths.id, sessions.groupMonthId))
    .innerJoin(groups, eq(groups.id, groupMonths.groupId))
    .where(and(eq(sessions.workspaceId, workspaceId), eq(sessions.status, "SCHEDULED"), gt(sessions.scheduledAt, now), inArray(sessions.groupMonthId, visibleGroupMonthIds)))
    .orderBy(asc(sessions.scheduledAt))
    .limit(1);
  if (!row) return undefined;
  return { sessionId: row.id, groupName: row.groupName, scheduledAt: row.scheduledAt, durationMinutes: row.durationMinutes, status: "SCHEDULED" };
}

/**
 * Sessions whose scheduled window has ENDED without the teacher completing
 * them — the «فائتة — لم تُسجَّل» bucket.
 *
 * Predicate (owner directive, Phase 2–3):
 *   `status IN ('SCHEDULED','IN_PROGRESS')`
 *   AND `scheduledAt + durationMinutes <= now`
 *   AND workspace + visible-group scope
 *
 * COMPLETED, CANCELLED, and RESCHEDULED are excluded by construction —
 * they are legitimate terminal states, never "missed". The predicate is
 * intentionally NOT tied to the CURRENT operating month, because a
 * missed session from an earlier month is still actionable (the teacher
 * can still record it late without changing the original `scheduledAt`).
 *
 * Ordering: `desc(scheduledAt)` — the most-recently-missed shows first so
 * the top of the list is the freshest actionable item. Paginated by
 * `limit` (identical pattern to the other Action Center listings); when
 * more rows exist than `limit`, the older ones are trimmed silently but
 * are still visible on the sessions calendar / list surfaces.
 *
 * Nothing here mutates `sessions.status` — display derivation only.
 */
export async function listMissedSessions(db: Db, workspaceId: string, visibleGroupIds: "ALL" | string[], limit: number, now: Date = new Date()): Promise<MissedSessionItem[]> {
  let groupMonthRows = await db
    .select({ id: groupMonths.id, groupId: groupMonths.groupId })
    .from(groupMonths)
    .where(eq(groupMonths.workspaceId, workspaceId));
  if (visibleGroupIds !== "ALL") {
    const visibleSet = new Set(visibleGroupIds);
    groupMonthRows = groupMonthRows.filter((gm) => visibleSet.has(gm.groupId));
  }
  if (groupMonthRows.length === 0) return [];
  const visibleGroupMonthIds = groupMonthRows.map((gm) => gm.id);

  const rows = await db
    .select({ id: sessions.id, scheduledAt: sessions.scheduledAt, status: sessions.status, groupId: groups.id, groupName: groups.name })
    .from(sessions)
    .innerJoin(groupMonths, eq(groupMonths.id, sessions.groupMonthId))
    .innerJoin(groups, eq(groups.id, groupMonths.groupId))
    .where(
      and(
        eq(sessions.workspaceId, workspaceId),
        or(eq(sessions.status, "SCHEDULED"), eq(sessions.status, "IN_PROGRESS")),
        lte(sql`${sessions.scheduledAt} + ${durationInterval}`, asTimestamptz(now)),
        inArray(sessions.groupMonthId, visibleGroupMonthIds),
      ),
    )
    .orderBy(desc(sessions.scheduledAt))
    .limit(limit);
  return rows.map((r) => ({
    sessionId: r.id,
    groupId: r.groupId,
    groupName: r.groupName,
    scheduledAt: r.scheduledAt,
    storedStatus: r.status as "SCHEDULED" | "IN_PROGRESS",
  }));
}

export interface MissedSessionItem {
  sessionId: string;
  groupId: string;
  groupName: string;
  scheduledAt: Date;
  /** The row's actual DB status — SCHEDULED = never started; IN_PROGRESS = started but never completed. Both are "missed" for display purposes but the late-recording flow differs (see the session details page). */
  storedStatus: "SCHEDULED" | "IN_PROGRESS";
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
  /**
   * Missed sessions (SCHEDULED or IN_PROGRESS whose slot has ended without
   * completion). Gated by the same `attendance.read` permission as the
   * regular missing-records section, but a caller with only follow-up
   * access still doesn't see this — it needs attendance access.
   */
  missed?: { visibleGroupIds: "ALL" | string[] };
  collection?: { restrictToGroupIds: string[] | undefined };
  subscription?: boolean;
  /** next-session is shown to any active member (scoped to their visible groups); always requested. */
  nextSession: { visibleGroupIds: "ALL" | string[] };
}

/**
 * An attention case enriched with the student name + its primary
 * (highest-severity) reason + the same reason's evidence snapshots, so
 * the action-center row can say WHO (student) and WHY (rule label +
 * concrete detail like "3 من آخر 5 حصص"). `primaryReason` is null only
 * for a case that has zero reasons — a defensive placeholder for
 * legacy rows before the rule engine started attaching them.
 */
export interface AttentionCasePrimaryReason {
  ruleKey: string;
  severity: "MEDIUM" | "HIGH";
  firstDetectedAt: Date;
  lastDetectedAt: Date;
  evidence: Array<{ observedAt: Date; sourceType: string; snapshot: Record<string, unknown> }>;
}
export interface AttentionCaseListItem {
  case: AttentionCaseRow;
  studentName: string;
  primaryRuleKey: string | null;
  primaryReason: AttentionCasePrimaryReason | null;
}

/** A due follow-up enriched with the student name, so its item names WHO. */
export interface FollowupListItem {
  followup: ScheduledFollowupRow;
  studentName: string;
}

export interface ActionCenterData {
  month: CurrentMonthRef | undefined;
  attentionCases: AttentionCaseListItem[] | undefined;
  followups: FollowupListItem[] | undefined;
  missingRecords: MissingRecordsSessionItem[] | undefined;
  missedSessions: MissedSessionItem[] | undefined;
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
  const [attentionCases, followups, missingRecords, missedSessions, collection, subscription, nextSession] = await Promise.all([
    p.attention
      ? listAttentionCasesForWorkspace(db, { workspaceId: p.workspaceId, restrictToGroupIds: p.attention.restrictToGroupIds, limit: p.limit })
      : Promise.resolve(undefined),
    p.followups
      ? listScheduledFollowups(db, { workspaceId: p.workspaceId, status: "PENDING", restrictToGroupIds: p.followups.restrictToGroupIds, limit: p.limit })
      : Promise.resolve(undefined),
    p.missing
      ? listSessionsWithMissingRecords(db, p.workspaceId, p.missing.visibleGroupIds, p.limit, month?.id, p.now)
      : Promise.resolve(undefined),
    p.missed
      ? listMissedSessions(db, p.workspaceId, p.missed.visibleGroupIds, p.limit, p.now)
      : Promise.resolve(undefined),
    p.collection
      ? listCollectionQueue(db, { workspaceId: p.workspaceId, restrictToGroupIds: p.collection.restrictToGroupIds, limit: p.limit })
      : Promise.resolve(undefined),
    p.subscription ? findSubscriptionByWorkspaceId(db, p.workspaceId) : Promise.resolve(undefined),
    getNextSession(db, p.workspaceId, p.nextSession.visibleGroupIds, p.now),
  ]);

  // Enrich attention cases + due follow-ups with the student NAME, and each
  // attention case with its primary (highest-severity) reason rule key, so the
  // action-center titles say WHO and WHY (e.g. "أحمد محمد — غياب متكرر") instead
  // of a generic "حالة انتباه". Two batched lookups (names + reasons), issued
  // together on this same transaction (postgres.js pipelines them) — one extra
  // round-trip, and only when there is anything to enrich.
  const attnStudentIds = attentionCases?.map((c) => c.studentId) ?? [];
  const fuStudentIds = followups?.map((f) => f.studentId) ?? [];
  const allStudentIds = [...new Set([...attnStudentIds, ...fuStudentIds])];
  const [nameRows, reasonRows] = await Promise.all([
    allStudentIds.length ? db.select({ id: students.id, name: students.name }).from(students).where(inArray(students.id, allStudentIds)) : Promise.resolve([]),
    attentionCases && attentionCases.length ? listAttentionReasonsForCases(db, attentionCases.map((c) => c.id)) : Promise.resolve([] as AttentionReasonRow[]),
  ]);
  const nameById = new Map(nameRows.map((s) => [s.id, s.name]));
  const reasonsByCase = new Map<string, AttentionReasonRow[]>();
  for (const r of reasonRows) {
    const list = reasonsByCase.get(r.attentionCaseId) ?? [];
    list.push(r);
    reasonsByCase.set(r.attentionCaseId, list);
  }
  // Pick the primary reason per case (HIGH severity wins; otherwise the
  // first). Then fetch evidence for just those primary-reason ids so the
  // Action Center row can carry a concrete cause line without fetching
  // every reason's evidence.
  //
  // GROUP-SCOPE LEAK GUARD (matches `computeVisiblePriority` on the case
  // detail path): a case is LISTED if it has at least one reason in a
  // visible group, but a case may also have reasons in groups the caller
  // does NOT have scope over. Picking the primary from the FULL reason
  // set would surface a reason (and, worse, its evidence) from an
  // invisible group. Filter reasons to the caller's `restrictToGroupIds`
  // FIRST — an `undefined` scope (ALL_GROUPS / owner) skips the filter.
  const visibleRestrict = p.attention?.restrictToGroupIds;
  const isReasonVisible = (r: AttentionReasonRow): boolean =>
    visibleRestrict === undefined || visibleRestrict.includes(r.groupId);
  const primaryReasonByCase = new Map<string, AttentionReasonRow>();
  if (attentionCases) {
    for (const c of attentionCases) {
      const rs = (reasonsByCase.get(c.id) ?? []).filter(isReasonVisible);
      const primary = rs.find((r) => r.severity === "HIGH") ?? rs[0];
      if (primary) primaryReasonByCase.set(c.id, primary);
    }
  }
  const primaryReasonIds = [...primaryReasonByCase.values()].map((r) => r.id);
  const primaryEvidenceRows: AttentionEvidenceRow[] = primaryReasonIds.length
    ? await listAttentionEvidenceForReasons(db, primaryReasonIds)
    : [];
  const evidenceByReason = new Map<string, AttentionEvidenceRow[]>();
  for (const e of primaryEvidenceRows) {
    const list = evidenceByReason.get(e.attentionReasonId) ?? [];
    list.push(e);
    evidenceByReason.set(e.attentionReasonId, list);
  }
  const attentionItems: AttentionCaseListItem[] | undefined = attentionCases?.map((c) => {
    const primary = primaryReasonByCase.get(c.id);
    const primaryReason: AttentionCasePrimaryReason | null = primary
      ? {
          ruleKey: primary.ruleKey,
          severity: primary.severity as "MEDIUM" | "HIGH",
          firstDetectedAt: primary.firstDetectedAt,
          lastDetectedAt: primary.lastDetectedAt,
          evidence: (evidenceByReason.get(primary.id) ?? []).map((e) => ({
            observedAt: e.observedAt,
            sourceType: e.sourceType,
            snapshot: (e.evidenceSnapshot ?? {}) as Record<string, unknown>,
          })),
        }
      : null;
    return {
      case: c,
      studentName: nameById.get(c.studentId) ?? "طالب",
      primaryRuleKey: primary?.ruleKey ?? null,
      primaryReason,
    };
  });
  const followupItems: FollowupListItem[] | undefined = followups?.map((f) => ({ followup: f, studentName: nameById.get(f.studentId) ?? "طالب" }));

  return { month, attentionCases: attentionItems, followups: followupItems, missingRecords, missedSessions, collection, subscription, nextSession };
}
