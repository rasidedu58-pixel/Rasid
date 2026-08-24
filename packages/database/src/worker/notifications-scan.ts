/**
 * Scheduled Notifications scan — Phase 9. Mirrors `subscription-expiry.ts`'s
 * own structure exactly: a broad, cross-tenant DISCOVERY query (relying on
 * the `TO app_worker`-scoped policies added in migrations 0038/0044) to
 * find candidates, then a per-workspace `withWorkerRuntimeContext` write
 * for each one found — never a single unscoped cross-tenant write.
 *
 * Three independent sub-scans, per the Phase 9 Closure correction:
 *
 * 1. SUBSCRIPTION_EXPIRING — reminders at 7/3/1 days before `period_end`
 *    (PRD §44.2 "Final"). Phase 10 Closure Delta: a worker outage longer
 *    than one reminder's own window must not permanently lose it — see
 *    `determineMilestoneToEmit`'s own doc comment for the deterministic
 *    catch-up rule (a normal on-time scan and a catch-up-after-outage scan
 *    are the exact same decision, no separate code path). This needed one
 *    new capability: `app_worker` can now SELECT `notifications` (scoped to
 *    the workspace it is currently scanning — migration 0047), so it can
 *    check which dedup keys a subscription already has before deciding
 *    whether the single most-relevant crossed milestone still needs firing.
 * 2. FOLLOWUP_DUE — one notification per `scheduled_followups` row that has
 *    become due (`due_at <= now`, `status = 'PENDING'`) — dedup key is the
 *    follow-up's own id, so it is created AT MOST once per follow-up ever
 *    (a completed/rescheduled follow-up is simply never found again by the
 *    `status = 'PENDING'` filter — no separate "cancel" logic needed).
 * 3. MISSING_RECORDS — one notification per Session actually found to have
 *    a real attendance/homework gap, using the EXACT SAME
 *    `deriveMissingRecords` Phase 5 already uses for `GET
 *    /sessions/{id}/review` (Phase 9 Closure correction #2 — this is
 *    deliberately NOT "session overdue and not completed").
 *
 * Every insert goes through `insertDedupedNotification`'s
 * `ON CONFLICT DO NOTHING` — safe under concurrent/retried scans by
 * construction (migration 0043's `notifications_dedup_unique`). DB dedup
 * remains the AUTHORITATIVE safety net for all three sub-scans, including
 * the subscription catch-up rule — `determineMilestoneToEmit`'s own
 * in-memory "already emitted" check is what decides which SINGLE milestone
 * to attempt (never more than one per scan), but the INSERT's own
 * `ON CONFLICT DO NOTHING` is what actually prevents a duplicate row if two
 * scans ever raced.
 */
import { and, eq, inArray, lte } from "drizzle-orm";
import { subscriptions } from "../schema/subscriptions";
import { notifications } from "../schema/notifications";
import { workspaces } from "../schema/workspaces";
import { scheduledFollowups } from "../schema/followup";
import { memberships } from "../schema/permissions";
import { sessions } from "../schema/sessions";
import { groupMonths } from "../schema/groups";
import { enrollments } from "../schema/enrollments";
import { sessionRecords } from "../schema/session-records";
import { students } from "../schema/students";
import { withWorkerRuntimeContext } from "../connection";
import { deriveEligibleEnrollmentIds } from "../session-mode/roster";
import { deriveMissingRecords } from "../session-mode/missing-records";
import { insertDedupedNotification } from "../repositories/notifications.repository";
import type { Db } from "../repositories/identity.repository";

const REMINDER_WINDOWS: ReadonlyArray<{ dedupKey: "7d" | "3d" | "1d"; days: number }> = [
  { dedupKey: "7d", days: 7 },
  { dedupKey: "3d", days: 3 },
  { dedupKey: "1d", days: 1 },
];
/** Half-width of the match window around each exact reminder day — generous relative to the worker's own polling cadence (minutes), so a late/slow cycle can never silently skip a reminder point. The 2-day minimum gap between consecutive reminder points (7d→3d, 3d→1d) means a 12h half-width (24h total window) can never double-match two adjacent points. */
const REMINDER_WINDOW_HALF_WIDTH_HOURS = 12;
const ACTIVE_SUBSCRIPTION_STATES = ["TRIAL", "ACTIVE", "EXPIRING"] as const;
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Pure, independently-testable window match — is `hoursUntilExpiry` close
 * enough to `days` (± the half-width) to count as THAT reminder point? A
 * worker cycle delayed by minutes (even hours) must still match; the
 * 2-day minimum gap between consecutive reminder points means a half-width
 * up to just under 24h can never double-match two adjacent points.
 *
 * Superseded by {@link determineMilestoneToEmit} for the actual scan logic
 * (Phase 10 Closure Delta — see its own doc comment) but kept and still
 * covered by its own tests: it remains a simple, correct description of
 * "is this scan on time for milestone `days`", useful on its own and as
 * the reference point the catch-up rule's tests are written against.
 */
export function matchesReminderWindow(hoursUntilExpiry: number, days: number, halfWidthHours: number = REMINDER_WINDOW_HALF_WIDTH_HOURS): boolean {
  return Math.abs(hoursUntilExpiry - days * 24) <= halfWidthHours;
}

/**
 * Phase 10 Closure Delta — deterministic catch-up rule for a worker outage
 * longer than a reminder milestone's own window (correction: a permanently
 * missed 7d/3d/1d reminder is "not acceptable" — a missed milestone must
 * still fire once, but never more than one stale warning at a time).
 *
 * V1 rule (product-approved): a milestone `d` has been "crossed" once less
 * than `d` days remain (`hoursUntilExpiry < d*24`) — no ±half-width window
 * needed here, since we no longer require landing close to the exact
 * instant; DB dedup (`notifications_dedup_unique`) is what makes emitting
 * the SAME milestone twice safe, so every scan can simply ask "what is the
 * single most relevant crossed-but-unemitted milestone right now" and try
 * it — a normal on-time scan and a catch-up-after-outage scan both flow
 * through the exact same decision, no separate code path.
 *
 * "Most recent" = the SMALLEST `d` among crossed milestones (closest to
 * `now`, i.e. the most urgent still-relevant one) — older crossed
 * milestones that were never emitted (because the worker was down through
 * their own window) are deliberately abandoned, not backfilled, per the
 * explicit "never emit multiple stale subscription warnings simultaneously"
 * requirement. `alreadyEmittedDedupKeys` (the dedup keys this subscription
 * already has a notification row for) is consulted so a scan that finds
 * "3d" already sent moves on without re-attempting it — it does NOT fall
 * back to a less urgent, already-past milestone.
 *
 * Returns `null` when: no milestone has been crossed yet (still more than
 * 7 days out); the subscription has already fully expired
 * (`hoursUntilExpiry < 0` — an expired subscription's 7d/3d/1d warnings are
 * obsolete by definition, "do NOT send obsolete reminders after the
 * subscription has already expired"); or the single most-relevant crossed
 * milestone was already emitted (the common, on-time case — nothing new to
 * do this scan). Deliberately does NOT fall back to a less-urgent,
 * already-past milestone just because it happens to be unemitted — e.g.
 * once "1d" has fired, a later scan must never emit a stale "3d" it skipped
 * over during the same outage, which is exactly what a naive
 * first-unemitted-in-list search would do.
 */
export function determineMilestoneToEmit(
  hoursUntilExpiry: number,
  alreadyEmittedDedupKeys: ReadonlySet<string>,
): { dedupKey: "7d" | "3d" | "1d"; days: number } | null {
  if (hoursUntilExpiry < 0) return null;
  const crossed = REMINDER_WINDOWS.filter((w) => hoursUntilExpiry < w.days * 24);
  if (crossed.length === 0) return null;
  const mostRecent = crossed.reduce((closest, w) => (w.days < closest.days ? w : closest));
  return alreadyEmittedDedupKeys.has(mostRecent.dedupKey) ? null : mostRecent;
}

export interface NotificationsScanResult {
  subscriptionScanned: number;
  subscriptionCreated: number;
  followupScanned: number;
  followupCreated: number;
  missingRecordsScanned: number;
  missingRecordsCreated: number;
}

export async function runNotificationsScan(workerDb: Db, now: Date = new Date()): Promise<NotificationsScanResult> {
  const [subscriptionResult, followupResult, missingRecordsResult] = await Promise.all([
    scanSubscriptionReminders(workerDb, now),
    scanFollowupsDue(workerDb, now),
    scanMissingRecords(workerDb),
  ]);
  return {
    subscriptionScanned: subscriptionResult.scanned,
    subscriptionCreated: subscriptionResult.created,
    followupScanned: followupResult.scanned,
    followupCreated: followupResult.created,
    missingRecordsScanned: missingRecordsResult.scanned,
    missingRecordsCreated: missingRecordsResult.created,
  };
}

// ---------------------------------------------------------------------------
// 1. Subscription expiry reminders
// ---------------------------------------------------------------------------

async function scanSubscriptionReminders(workerDb: Db, now: Date): Promise<{ scanned: number; created: number }> {
  const candidates = await workerDb
    .select()
    .from(subscriptions)
    .where(inArray(subscriptions.state, [...ACTIVE_SUBSCRIPTION_STATES]));

  let created = 0;
  for (const subscription of candidates) {
    if (!subscription.periodEnd) continue;
    const hoursUntilExpiry = (subscription.periodEnd.getTime() - now.getTime()) / MS_PER_HOUR;

    const wasCreated = await withWorkerRuntimeContext({ workspaceId: subscription.workspaceId }, async (tx) => {
      // Phase 10 Closure Delta — catch-up rule (see determineMilestoneToEmit's
      // own doc comment): what matters is which dedup keys THIS subscription
      // already has, not a fixed exact-window check, so that a worker outage
      // spanning a whole reminder window still emits the single most-relevant
      // missed milestone once, and never floods multiple stale ones. Reading
      // the existing dedup keys costs one extra SELECT per candidate
      // subscription — candidates are already filtered to active-ish states
      // only (small set, not the whole workspace table), so this stays a
      // cheap, workspace-scoped query, not a new N+1 hot path of consequence.
      const existingRows = await tx
        .select({ dedupKey: notifications.dedupKey })
        .from(notifications)
        .where(
          and(
            eq(notifications.workspaceId, subscription.workspaceId),
            eq(notifications.type, "SUBSCRIPTION_EXPIRING"),
            eq(notifications.entityType, "subscription"),
            eq(notifications.entityId, subscription.id),
          ),
        );
      const alreadyEmitted = new Set(existingRows.map((r) => r.dedupKey));
      const milestone = determineMilestoneToEmit(hoursUntilExpiry, alreadyEmitted);
      if (!milestone) return false;

      const [workspace] = await tx.select({ ownerUserId: workspaces.ownerUserId, name: workspaces.name }).from(workspaces).where(eq(workspaces.id, subscription.workspaceId)).limit(1);
      if (!workspace) return false;
      return insertDedupedNotification(tx, {
        workspaceId: subscription.workspaceId,
        userId: workspace.ownerUserId,
        type: "SUBSCRIPTION_EXPIRING",
        title: "اقتراب انتهاء الاشتراك",
        body: `اشتراك مساحة العمل «${workspace.name}» سينتهي خلال ${milestone.days} ${milestone.days === 1 ? "يوم" : "أيام"}.`,
        entityType: "subscription",
        entityId: subscription.id,
        dedupKey: milestone.dedupKey,
      });
    });
    if (wasCreated) created += 1;
  }
  return { scanned: candidates.length, created };
}

// ---------------------------------------------------------------------------
// 2. Follow-ups due
// ---------------------------------------------------------------------------

async function scanFollowupsDue(workerDb: Db, now: Date): Promise<{ scanned: number; created: number }> {
  const candidates = await workerDb
    .select()
    .from(scheduledFollowups)
    .where(and(eq(scheduledFollowups.status, "PENDING"), lte(scheduledFollowups.dueAt, now)));

  let created = 0;
  for (const followup of candidates) {
    const wasCreated = await withWorkerRuntimeContext({ workspaceId: followup.workspaceId }, async (tx) => {
      let recipientUserId: string | undefined;
      if (followup.assigneeMembershipId) {
        const [membership] = await tx.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.id, followup.assigneeMembershipId)).limit(1);
        recipientUserId = membership?.userId;
      }
      if (!recipientUserId) {
        const [workspace] = await tx.select({ ownerUserId: workspaces.ownerUserId }).from(workspaces).where(eq(workspaces.id, followup.workspaceId)).limit(1);
        recipientUserId = workspace?.ownerUserId;
      }
      if (!recipientUserId) return false;

      return insertDedupedNotification(tx, {
        workspaceId: followup.workspaceId,
        userId: recipientUserId,
        type: "FOLLOWUP_DUE",
        title: "متابعة مستحقة",
        body: "لديك متابعة مجدولة مستحقة الآن.",
        entityType: "scheduled_followup",
        entityId: followup.id,
        dedupKey: followup.id,
      });
    });
    if (wasCreated) created += 1;
  }
  return { scanned: candidates.length, created };
}

// ---------------------------------------------------------------------------
// 3. Missing records — reuses Phase 5's own `deriveMissingRecords` (Closure
// correction #2), never "session overdue and not completed".
// ---------------------------------------------------------------------------

async function scanMissingRecords(workerDb: Db): Promise<{ scanned: number; created: number }> {
  const candidates = await workerDb.select().from(sessions).where(eq(sessions.status, "IN_PROGRESS"));

  let created = 0;
  for (const session of candidates) {
    const wasCreated = await withWorkerRuntimeContext({ workspaceId: session.workspaceId }, async (tx) => {
      const [groupMonth] = await tx.select().from(groupMonths).where(eq(groupMonths.id, session.groupMonthId)).limit(1);
      if (!groupMonth) return false;
      const [workspace] = await tx.select({ ownerUserId: workspaces.ownerUserId, timezone: workspaces.timezone }).from(workspaces).where(eq(workspaces.id, session.workspaceId)).limit(1);
      if (!workspace) return false;

      const enrollmentRows = await tx
        .select({ id: enrollments.id, studentId: enrollments.studentId, joinDate: enrollments.joinDate, endedAt: enrollments.endedAt })
        .from(enrollments)
        .where(eq(enrollments.groupMonthId, groupMonth.id));
      if (enrollmentRows.length === 0) return false;

      const studentRows = await tx
        .select({ id: students.id, name: students.name })
        .from(students)
        .where(inArray(students.id, enrollmentRows.map((e) => e.studentId)));
      const studentNameById = new Map(studentRows.map((s) => [s.id, s.name]));
      const studentNameByEnrollmentId = new Map(enrollmentRows.map((e) => [e.id, studentNameById.get(e.studentId) ?? ""]));

      const eligibleEnrollmentIds = deriveEligibleEnrollmentIds({
        enrollments: enrollmentRows.map((e) => ({ enrollmentId: e.id, joinDate: e.joinDate, endedAt: e.endedAt })),
        sessionScheduledAt: session.scheduledAt,
        workspaceTimezone: workspace.timezone,
      });
      const records = await tx.select().from(sessionRecords).where(eq(sessionRecords.sessionId, session.id));
      const recordsByEnrollmentId = new Map(records.map((r) => [r.enrollmentId, r]));

      const { missingRecords } = deriveMissingRecords({ eligibleEnrollmentIds, recordsByEnrollmentId, studentNameByEnrollmentId });
      if (missingRecords.length === 0) return false;

      return insertDedupedNotification(tx, {
        workspaceId: session.workspaceId,
        userId: workspace.ownerUserId,
        type: "MISSING_RECORDS",
        title: "سجلات ناقصة",
        body: `يوجد ${missingRecords.length} سجل حضور/واجب ناقص في حصة جارية.`,
        entityType: "session",
        entityId: session.id,
        dedupKey: session.id,
      });
    });
    if (wasCreated) created += 1;
  }
  return { scanned: candidates.length, created };
}
