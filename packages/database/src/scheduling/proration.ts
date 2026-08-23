/**
 * Mid-month proration algorithm — PRD §33.1 "Mid-month financial formula",
 * literal source of truth. Pure domain function, no I/O, colocated with
 * `session-generator.ts` since it operates on the same session-shape data
 * (Phase 4 computes this on demand from `sessions` rows; it does NOT
 * persist a `financial_obligations` row — that table does not exist until
 * Phase 6, pre-authorized scoping decision #1).
 *
 * Formula:
 *   countable session := billableForProration === true
 *                         AND status NOT IN ('CANCELLED', 'RESCHEDULED')
 *   totalActualBillableSessions := count(countable sessions in the GroupMonth)
 *   eligibleRemainingSessions   := count(countable sessions WHERE
 *                                    scheduledAt >= joinDate, compared as
 *                                    workspace-local CALENDAR DATES — same-day
 *                                    is eligible, PRD §33.1 join-date rule)
 *   proratedDueMinor := HALF_UP_ROUND(baseFeeMinor * eligibleRemainingSessions
 *                                      / totalActualBillableSessions)
 *   — rounded ONCE at the final result, never on any intermediate value.
 *
 * A RESCHEDULED (original, superseded) session is excluded; its replacement
 * (status SCHEDULED/COMPLETED, origin=RESCHEDULE_REPLACEMENT) is what gets
 * counted, so the pair counts once total (matches Phase 3's own "counts
 * once" guarantee for reschedules). CANCELLED sessions are excluded
 * unconditionally. A MANUAL-origin session only counts if its
 * `billableForProration` flag is explicitly true — this function does not
 * special-case `origin` at all, it only ever reads the stored
 * `billableForProration` flag + `status`, which is sufficient because the
 * flag is already origin-aware at write time (Phase 3's session-generation/
 * reschedule pipeline sets it true for GENERATED/RESCHEDULE_REPLACEMENT
 * sessions and leaves it at its schema DEFAULT false for MANUAL ones).
 *
 * If `totalActualBillableSessions === 0`, REMAINING_SESSIONS is NOT
 * computable — `computeProration` returns the `"UNAVAILABLE"` sentinel
 * rather than dividing by zero or fabricating a result; the API layer maps
 * this to the PRD-specified message: "لا توجد حصص قابلة للحساب هذا الشهر؛
 * اختر مبلغًا كاملاً أو مخصصًا."
 */
import { DateTime } from "luxon";

export interface ProrationSessionInput {
  scheduledAt: Date;
  status: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "RESCHEDULED";
  billableForProration: boolean;
}

export interface ProrationResult {
  baseFeeMinor: number;
  eligibleSessions: number;
  totalBillableSessions: number;
  calculatedDueMinor: number;
  formula: "REMAINING_SESSIONS";
  rounding: "HALF_UP_FINAL_MINOR_UNIT";
}

export const PRORATION_UNAVAILABLE = "UNAVAILABLE" as const;

const NON_COUNTABLE_STATUSES = new Set(["CANCELLED", "RESCHEDULED"]);

function isCountable(session: ProrationSessionInput): boolean {
  return session.billableForProration === true && !NON_COUNTABLE_STATUSES.has(session.status);
}

/**
 * Half-up rounding to the nearest integer minor unit — never Postgres/
 * banker's round-half-to-even. `Math.round` in JavaScript already rounds
 * .5 away from zero for positive inputs (which minor-unit money amounts
 * always are here), so it matches half-up directly; implemented explicitly
 * rather than relied upon implicitly so the rounding rule is visible and
 * testable independent of `Math.round`'s general semantics.
 */
function halfUpRound(value: number): number {
  return Math.floor(value + 0.5);
}

/**
 * Computes REMAINING_SESSIONS proration for one enrollment joining a
 * GroupMonth. `joinDate` and `workspaceTimezone` are compared as
 * workspace-local calendar dates (PRD §33.1: "scheduled date-time on/after
 * join_date in Workspace timezone is eligible; same-day session is
 * eligible") — NOT a raw UTC-instant comparison, which would incorrectly
 * exclude/include sessions near local midnight depending on timezone offset.
 */
export function computeProration(params: {
  baseFeeMinor: number;
  joinDate: string; // "YYYY-MM-DD"
  workspaceTimezone: string;
  sessions: ProrationSessionInput[];
}): ProrationResult | typeof PRORATION_UNAVAILABLE {
  const countable = params.sessions.filter(isCountable);
  const totalBillableSessions = countable.length;

  if (totalBillableSessions === 0) {
    return PRORATION_UNAVAILABLE;
  }

  const joinDay = DateTime.fromISO(params.joinDate, { zone: params.workspaceTimezone }).startOf("day");

  const eligibleSessions = countable.filter((session) => {
    const sessionDay = DateTime.fromJSDate(session.scheduledAt, { zone: params.workspaceTimezone }).startOf("day");
    return sessionDay >= joinDay;
  }).length;

  const rawDue = (params.baseFeeMinor * eligibleSessions) / totalBillableSessions;
  const calculatedDueMinor = halfUpRound(rawDue);

  return {
    baseFeeMinor: params.baseFeeMinor,
    eligibleSessions,
    totalBillableSessions,
    calculatedDueMinor,
    formula: "REMAINING_SESSIONS",
    rounding: "HALF_UP_FINAL_MINOR_UNIT",
  };
}
