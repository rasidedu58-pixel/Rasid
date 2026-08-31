/**
 * Operating-Month PREPARE / ACTIVATE eligibility — pure, timezone-aware, no DB
 * access, independently unit-testable (same convention as finance/due-date.ts).
 *
 * Two distinct flows (Overrides unit):
 * - PREPARE: create the next month. If it hasn't started yet it becomes a DRAFT
 *   (the current month stays CURRENT, nothing is archived); if it has already
 *   started (catch-up / bootstrap) it is created-and-started as CURRENT.
 * - ACTIVATE: flip an existing DRAFT to CURRENT (archiving the old CURRENT) —
 *   only once the DRAFT's calendar month has actually begun.
 *
 * Entitlement (CREATE_MONTH / valid subscription) is enforced by the API guard,
 * NOT here — an override never grants entitlement.
 */
import { DateTime } from "luxon";

export interface MonthRef {
  year: number;
  month: number;
}
export interface MonthOverrideState {
  prepBlocked: boolean;
  earlyPrepAllowed: boolean;
}

export type PrepBlockReason = "PREP_BLOCKED" | "NOT_NEXT_MONTH" | "DUPLICATE" | "OUTSIDE_WINDOW";
export type PrepEligibility =
  | { allowed: true; status: "DRAFT" | "CURRENT" }
  | { allowed: false; reason: PrepBlockReason };

export type ActivationBlockReason = "NOT_DRAFT" | "NOT_NEXT_MONTH" | "NOT_STARTED";
export type ActivationEligibility = { allowed: true } | { allowed: false; reason: ActivationBlockReason };

export function nextMonth(m: MonthRef): MonthRef {
  return m.month === 12 ? { year: m.year + 1, month: 1 } : { year: m.year, month: m.month + 1 };
}
export function sameMonth(a: MonthRef, b: MonthRef): boolean {
  return a.year === b.year && a.month === b.month;
}

function firstOf(m: MonthRef, tz: string): DateTime {
  return DateTime.fromObject({ year: m.year, month: m.month, day: 1 }, { zone: tz }).startOf("day");
}
function zoned(now: Date, tz: string): DateTime {
  return DateTime.fromJSDate(now).setZone(tz);
}

/** The calendar month `now` falls in, in the workspace timezone. */
export function currentCalendarMonth(now: Date, tz: string): MonthRef {
  const z = zoned(now, tz);
  return { year: z.year, month: z.month };
}

/** Has the target month's calendar month begun, in the workspace timezone? */
export function targetMonthStarted(target: MonthRef, now: Date, tz: string): boolean {
  return zoned(now, tz) >= firstOf(target, tz);
}

/** Is `now` within the last `windowDays` days of the current operating month's calendar month? */
export function withinPrepWindow(current: MonthRef, now: Date, tz: string, windowDays: number): boolean {
  const first = firstOf(current, tz);
  const daysInMonth = first.daysInMonth ?? 30;
  const windowStart = first.set({ day: Math.max(1, daysInMonth - windowDays + 1) }).startOf("day");
  const endOfMonth = first.endOf("month");
  const nowZ = zoned(now, tz);
  return nowZ >= windowStart && nowZ <= endOfMonth;
}

/** ISO instant when the natural prep window opens (for the "يبدأ التجهيز في …" UI). */
export function prepWindowOpensAt(current: MonthRef, tz: string, windowDays: number): string | null {
  const first = firstOf(current, tz);
  const daysInMonth = first.daysInMonth ?? 30;
  return first.set({ day: Math.max(1, daysInMonth - windowDays + 1) }).startOf("day").toISO();
}

/**
 * PREPARE eligibility. Precedence (deterministic):
 * 1. (entitlement — enforced by guard, not here)
 * 2. PREP_BLOCKED active → block
 * 3. target must be the immediate next month → else block
 * 4. duplicate month/draft for target → block
 * 5. target month already started (catch-up / bootstrap) → allow, create as CURRENT
 * 6. within the natural window → allow, create as DRAFT
 * 7. EARLY_PREP_ALLOWED active → allow, create as DRAFT
 * 8. else → block (outside window)
 */
export function evaluateMonthPrepEligibility(params: {
  current: MonthRef | null; // null = bootstrap (no operating months yet)
  target: MonthRef;
  now: Date;
  timezone: string;
  windowDays: number;
  override: MonthOverrideState;
  duplicateExists: boolean;
}): PrepEligibility {
  const { current, target, now, timezone, windowDays, override, duplicateExists } = params;

  // Bootstrap: first ever month → created and started immediately, no window.
  if (!current) {
    if (duplicateExists) return { allowed: false, reason: "DUPLICATE" };
    return { allowed: true, status: "CURRENT" };
  }

  if (override.prepBlocked) return { allowed: false, reason: "PREP_BLOCKED" };
  if (!sameMonth(target, nextMonth(current))) return { allowed: false, reason: "NOT_NEXT_MONTH" };
  if (duplicateExists) return { allowed: false, reason: "DUPLICATE" };

  // Catch-up: the next month has already begun and wasn't prepared → create+start.
  if (targetMonthStarted(target, now, timezone)) return { allowed: true, status: "CURRENT" };
  if (withinPrepWindow(current, now, timezone, windowDays)) return { allowed: true, status: "DRAFT" };
  if (override.earlyPrepAllowed) return { allowed: true, status: "DRAFT" };
  return { allowed: false, reason: "OUTSIDE_WINDOW" };
}

/**
 * ACTIVATE eligibility for an existing DRAFT. EARLY_PREP_ALLOWED never permits
 * early activation — the DRAFT's calendar month must have actually begun.
 */
export function evaluateMonthActivation(params: {
  draft: MonthRef;
  draftStatus: string;
  current: MonthRef | null;
  now: Date;
  timezone: string;
}): ActivationEligibility {
  if (params.draftStatus !== "DRAFT") return { allowed: false, reason: "NOT_DRAFT" };
  if (params.current && !sameMonth(params.draft, nextMonth(params.current))) return { allowed: false, reason: "NOT_NEXT_MONTH" };
  if (!targetMonthStarted(params.draft, params.now, params.timezone)) return { allowed: false, reason: "NOT_STARTED" };
  return { allowed: true };
}
