/**
 * Pure Session roster-eligibility derivation — Phase 5. Mirrors
 * `scheduling/proration.ts`'s convention (pure, timezone-aware, no DB
 * access) so it is independently unit-testable.
 *
 * Eligibility rule (Phase 5 Closure Delta — re-derived from the Database
 * Schema's own field types, see item 2 of the closure delta):
 *
 * 1. Join side: `join_date` is a `date` column (Database Schema §7.1) — it
 *    has no time-of-day of its own, so it MUST be compared as a calendar
 *    day in the workspace's timezone against the Session's own local day.
 *    PRD's "join-date eligibility... same-day session eligible" rule
 *    (§18/AC-06) makes the boundary explicit: `sessionDay >= joinDay` is
 *    eligible.
 * 2. End side: `ended_at` is a real `timestamptz` (Database Schema §7.1),
 *    not a date — comparing it as a calendar day would silently invent a
 *    same-day-inclusion/exclusion rule the governing docs never state (they
 *    only say "timestamptz NULL — —", no note either way). The
 *    schema-correct comparison is therefore a precise INSTANT comparison
 *    against the Session's own precise `scheduled_at` instant, with no day
 *    truncation on either side: `sessionScheduledAt < endedAt` is eligible.
 *
 * Caveat (documented, not "fixed" here — out of this delta's scope): Phase
 * 4's `POST /enrollments/:id/withdraw` stores `effectiveDate` as UTC
 * midnight of the given calendar date (`${effectiveDate}T00:00:00Z`), not a
 * workspace-timezone-aware instant. That is a Phase 4 representation
 * choice for `ended_at`, independent of this function's own (correct, per
 * the column's declared type) instant-vs-instant comparison rule.
 */
import { DateTime } from "luxon";

export interface RosterEligibilityInput {
  enrollmentId: string;
  /** "YYYY-MM-DD" */
  joinDate: string;
  endedAt: Date | null;
}

export function isEnrollmentEligibleForSession(params: {
  enrollment: RosterEligibilityInput;
  sessionScheduledAt: Date;
  workspaceTimezone: string;
}): boolean {
  const sessionDay = DateTime.fromJSDate(params.sessionScheduledAt, { zone: params.workspaceTimezone }).startOf("day");
  const joinDay = DateTime.fromISO(params.enrollment.joinDate, { zone: params.workspaceTimezone }).startOf("day");
  if (sessionDay < joinDay) return false;

  if (params.enrollment.endedAt && params.sessionScheduledAt >= params.enrollment.endedAt) {
    return false;
  }

  return true;
}

export function deriveEligibleEnrollmentIds(params: {
  enrollments: RosterEligibilityInput[];
  sessionScheduledAt: Date;
  workspaceTimezone: string;
}): string[] {
  return params.enrollments
    .filter((enrollment) =>
      isEnrollmentEligibleForSession({
        enrollment,
        sessionScheduledAt: params.sessionScheduledAt,
        workspaceTimezone: params.workspaceTimezone,
      }),
    )
    .map((e) => e.enrollmentId);
}
