/**
 * Pure Session roster-eligibility derivation — Phase 5. Mirrors
 * `scheduling/proration.ts`'s convention (pure, timezone-aware, no DB
 * access) so it is independently unit-testable.
 *
 * Eligibility rule: an Enrollment is on a Session's roster iff the
 * Session's LOCAL calendar day (workspace timezone) is on/after the
 * Enrollment's `join_date` (PRD's own "join-date eligibility... same-day
 * session eligible" rule, §18/AC-06) AND, when the Enrollment has since
 * ended (`ended_at` set — WITHDRAWN/TRANSFERRED/STOPPED), the Session's
 * local day is STRICTLY BEFORE the local day the Enrollment ended on.
 *
 * The `ended_at` half is a necessary technical interpretation, not a
 * literal quote from the governing docs (only join_date eligibility is
 * spelled out there) — resolving it any other way would mean a withdrawn/
 * transferred student stays on every future roster of a group they already
 * left, which contradicts the roster's own purpose. Documented explicitly
 * in the Phase 5 completion report.
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

  if (params.enrollment.endedAt) {
    const endedDay = DateTime.fromJSDate(params.enrollment.endedAt, { zone: params.workspaceTimezone }).startOf("day");
    if (sessionDay >= endedDay) return false;
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
