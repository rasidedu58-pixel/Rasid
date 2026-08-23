/**
 * Session generation algorithm — Technical Architecture §8 "Session
 * Engine", Database Schema §5.5/§5.6, API Contract §14 (Date/Time and Money
 * Contract: ISO 8601 UTC storage, workspace timezone for business
 * calendar).
 *
 * Pure domain function, no I/O — unit-testable without a live database or
 * network access. Given a workspace's IANA timezone, a target
 * (year, month), and a single `ScheduleRule`, computes every calendar
 * occurrence of that rule's weekday within the month AND within
 * [effectiveFrom, effectiveTo] (if set), producing a UTC instant for each
 * occurrence via `DateTime.fromObject({...}, { zone }).toUTC()`.
 *
 * WEEKDAY CONVENTION (implementation detail, documented and applied
 * consistently — not a product decision): `weekday` is 0..6, ISO-style,
 * where 0 = Monday and 6 = Sunday (matches Luxon's own `DateTime#weekday`
 * minus one, since Luxon uses ISO 1 = Monday .. 7 = Sunday). Every caller in
 * this codebase (schedule_rules rows, request/response DTOs) must use this
 * same convention.
 *
 * No fixed/hardcoded occurrence count: a month can have 4 or 5 occurrences
 * of a given weekday depending on how many days it has and where day 1
 * falls — this function walks every calendar day in the month rather than
 * assuming a count.
 */
import { DateTime } from "luxon";

export interface ScheduleRuleInput {
  /** 0 = Monday .. 6 = Sunday. See module doc comment for the convention. */
  weekday: number;
  /** "HH:mm" or "HH:mm:ss", local wall-clock time in the workspace timezone. */
  startTime: string;
  durationMinutes: number;
  /** "YYYY-MM-DD", inclusive lower bound, or null/undefined for no bound. */
  effectiveFrom?: string | null;
  /** "YYYY-MM-DD", inclusive upper bound, or null/undefined for no bound. */
  effectiveTo?: string | null;
}

export interface GeneratedOccurrence {
  /** UTC instant. */
  scheduledAt: Date;
  durationMinutes: number;
}

export class InvalidScheduleRuleError extends Error {}

function parseStartTime(startTime: string): { hour: number; minute: number; second: number } {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(startTime.trim());
  if (!match) {
    throw new InvalidScheduleRuleError(`Invalid startTime "${startTime}" — expected "HH:mm" or "HH:mm:ss".`);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] ? Number(match[3]) : 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    throw new InvalidScheduleRuleError(`Invalid startTime "${startTime}" — out of range.`);
  }
  return { hour, minute, second };
}

/**
 * Generates every UTC-instant occurrence of `rule` that falls within the
 * calendar month (`year`, `month` 1-12) in `workspaceTimezone`, further
 * narrowed by `rule.effectiveFrom`/`rule.effectiveTo` when set (inclusive on
 * both ends, compared as local calendar dates in `workspaceTimezone`).
 */
export function generateSessionOccurrences(params: {
  workspaceTimezone: string;
  year: number;
  month: number;
  rule: ScheduleRuleInput;
}): GeneratedOccurrence[] {
  const { workspaceTimezone, year, month, rule } = params;

  if (rule.weekday < 0 || rule.weekday > 6 || !Number.isInteger(rule.weekday)) {
    throw new InvalidScheduleRuleError(`Invalid weekday ${rule.weekday} — expected an integer 0..6.`);
  }
  if (!Number.isInteger(rule.durationMinutes) || rule.durationMinutes <= 0) {
    throw new InvalidScheduleRuleError(`Invalid durationMinutes ${rule.durationMinutes} — must be > 0.`);
  }

  const { hour, minute, second } = parseStartTime(rule.startTime);

  const monthStart = DateTime.fromObject({ year, month, day: 1 }, { zone: workspaceTimezone });
  if (!monthStart.isValid) {
    throw new InvalidScheduleRuleError(
      `Invalid (year=${year}, month=${month}, zone=${workspaceTimezone}): ${monthStart.invalidReason} ${monthStart.invalidExplanation ?? ""}`,
    );
  }
  const daysInMonth = monthStart.daysInMonth;
  if (!daysInMonth) {
    throw new InvalidScheduleRuleError(`Could not determine days in month for ${year}-${month}.`);
  }

  const effectiveFrom = rule.effectiveFrom
    ? DateTime.fromISO(rule.effectiveFrom, { zone: workspaceTimezone }).startOf("day")
    : null;
  const effectiveTo = rule.effectiveTo
    ? DateTime.fromISO(rule.effectiveTo, { zone: workspaceTimezone }).startOf("day")
    : null;
  if (effectiveFrom && !effectiveFrom.isValid) {
    throw new InvalidScheduleRuleError(`Invalid effectiveFrom "${rule.effectiveFrom}".`);
  }
  if (effectiveTo && !effectiveTo.isValid) {
    throw new InvalidScheduleRuleError(`Invalid effectiveTo "${rule.effectiveTo}".`);
  }

  const occurrences: GeneratedOccurrence[] = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const candidateDay = DateTime.fromObject({ year, month, day }, { zone: workspaceTimezone }).startOf("day");
    // Luxon: 1 = Monday .. 7 = Sunday. Our convention: 0 = Monday .. 6 = Sunday.
    const ourWeekday = candidateDay.weekday - 1;
    if (ourWeekday !== rule.weekday) continue;
    if (effectiveFrom && candidateDay < effectiveFrom) continue;
    if (effectiveTo && candidateDay > effectiveTo) continue;

    const occurrence = candidateDay.set({ hour, minute, second, millisecond: 0 });
    occurrences.push({
      scheduledAt: occurrence.toUTC().toJSDate(),
      durationMinutes: rule.durationMinutes,
    });
  }

  return occurrences;
}

/** Convenience: generate occurrences for every rule in a list, flattened. */
export function generateSessionOccurrencesForRules(params: {
  workspaceTimezone: string;
  year: number;
  month: number;
  rules: ScheduleRuleInput[];
}): GeneratedOccurrence[] {
  return params.rules.flatMap((rule) =>
    generateSessionOccurrences({
      workspaceTimezone: params.workspaceTimezone,
      year: params.year,
      month: params.month,
      rule,
    }),
  );
}
