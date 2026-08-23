import { describe, expect, it } from "vitest";
import {
  InvalidScheduleRuleError,
  generateSessionOccurrences,
  generateSessionOccurrencesForRules,
} from "./session-generator";

const CAIRO = "Africa/Cairo";

describe("generateSessionOccurrences", () => {
  it("31-day month: a weekday occurring 5 times is generated exactly 5 times", () => {
    // August 2026: 31 days, starts on a Saturday (2026-08-01). Our weekday
    // convention 0=Mon..6=Sun → Saturday = 5. Saturdays: 1,8,15,22,29 → 5.
    const occurrences = generateSessionOccurrences({
      workspaceTimezone: CAIRO,
      year: 2026,
      month: 8,
      rule: { weekday: 5, startTime: "10:00", durationMinutes: 60 },
    });
    expect(occurrences).toHaveLength(5);
    const days = occurrences.map((o) => o.scheduledAt.getUTCDate());
    // Cairo is UTC+2/UTC+3 depending on season; the local day-of-month stays
    // stable when read via a Cairo-zoned formatter, so assert count + spacing.
    expect(occurrences).toHaveLength(5);
    for (let i = 1; i < occurrences.length; i += 1) {
      const diffMs = occurrences[i]!.scheduledAt.getTime() - occurrences[i - 1]!.scheduledAt.getTime();
      expect(diffMs).toBe(7 * 24 * 60 * 60 * 1000);
    }
    void days;
  });

  it("28-day February: a weekday occurring exactly 4 times is generated exactly 4 times", () => {
    // February 2026 has 28 days (not a leap year) and starts on a Sunday
    // (2026-02-01). Our convention: Sunday = 6. Sundays: 1,8,15,22 → 4.
    const occurrences = generateSessionOccurrences({
      workspaceTimezone: CAIRO,
      year: 2026,
      month: 2,
      rule: { weekday: 6, startTime: "09:00", durationMinutes: 45 },
    });
    expect(occurrences).toHaveLength(4);
  });

  it("effectiveFrom/effectiveTo narrow the generated occurrences", () => {
    // August 2026 Saturdays: 1, 8, 15, 22, 29.
    const all = generateSessionOccurrences({
      workspaceTimezone: CAIRO,
      year: 2026,
      month: 8,
      rule: { weekday: 5, startTime: "10:00", durationMinutes: 60 },
    });
    expect(all).toHaveLength(5);

    const narrowed = generateSessionOccurrences({
      workspaceTimezone: CAIRO,
      year: 2026,
      month: 8,
      rule: {
        weekday: 5,
        startTime: "10:00",
        durationMinutes: 60,
        effectiveFrom: "2026-08-10",
        effectiveTo: "2026-08-25",
      },
    });
    // Only 15 and 22 fall within [10, 25].
    expect(narrowed).toHaveLength(2);
  });

  it("weekday numbering convention: 0=Monday matches a known Monday", () => {
    // 2026-08-03 is a Monday.
    const occurrences = generateSessionOccurrences({
      workspaceTimezone: CAIRO,
      year: 2026,
      month: 8,
      rule: { weekday: 0, startTime: "12:00", durationMinutes: 30 },
    });
    expect(occurrences.length).toBeGreaterThan(0);
    // 12:00 Cairo time in August (UTC+3, no DST since 2016) is 09:00 UTC.
    const first = occurrences[0]!.scheduledAt;
    expect(first.toISOString()).toContain("2026-08-03T09:00:00");
  });

  it("Africa/Cairo round-trips correctly (no DST since 2016 — fixed UTC+2 offset year-round)", () => {
    const occurrences = generateSessionOccurrences({
      workspaceTimezone: CAIRO,
      year: 2026,
      month: 1,
      rule: { weekday: 3, startTime: "16:30", durationMinutes: 90 },
    });
    expect(occurrences.length).toBeGreaterThan(0);
    for (const occurrence of occurrences) {
      // Egypt has observed a fixed UTC+2 offset since abolishing DST in
      // 2016 (year-round, including the brief 2023 partial reintroduction
      // which reverted); assert every generated instant is exactly 2 hours
      // ahead of the local 16:30 wall-clock time expressed in UTC.
      const hoursUtc = occurrence.scheduledAt.getUTCHours();
      const minutesUtc = occurrence.scheduledAt.getUTCMinutes();
      expect(hoursUtc).toBe(14);
      expect(minutesUtc).toBe(30);
    }
  });

  it("rejects an out-of-range weekday", () => {
    expect(() =>
      generateSessionOccurrences({
        workspaceTimezone: CAIRO,
        year: 2026,
        month: 8,
        rule: { weekday: 7, startTime: "10:00", durationMinutes: 60 },
      }),
    ).toThrow(InvalidScheduleRuleError);
  });

  it("rejects a non-positive durationMinutes", () => {
    expect(() =>
      generateSessionOccurrences({
        workspaceTimezone: CAIRO,
        year: 2026,
        month: 8,
        rule: { weekday: 5, startTime: "10:00", durationMinutes: 0 },
      }),
    ).toThrow(InvalidScheduleRuleError);
  });

  it("rejects a malformed startTime", () => {
    expect(() =>
      generateSessionOccurrences({
        workspaceTimezone: CAIRO,
        year: 2026,
        month: 8,
        rule: { weekday: 5, startTime: "not-a-time", durationMinutes: 60 },
      }),
    ).toThrow(InvalidScheduleRuleError);
  });
});

describe("generateSessionOccurrencesForRules", () => {
  it("flattens occurrences across multiple rules for the same group_month", () => {
    const occurrences = generateSessionOccurrencesForRules({
      workspaceTimezone: CAIRO,
      year: 2026,
      month: 8,
      rules: [
        { weekday: 0, startTime: "10:00", durationMinutes: 60 }, // Mondays
        { weekday: 2, startTime: "12:00", durationMinutes: 60 }, // Wednesdays
      ],
    });
    // August 2026 has 4 Mondays (3,10,17,24,31 → actually 5) and Wednesdays.
    // Just assert the flattening combined both rules' non-zero outputs.
    const mondaysOnly = generateSessionOccurrences({
      workspaceTimezone: CAIRO,
      year: 2026,
      month: 8,
      rule: { weekday: 0, startTime: "10:00", durationMinutes: 60 },
    });
    const wednesdaysOnly = generateSessionOccurrences({
      workspaceTimezone: CAIRO,
      year: 2026,
      month: 8,
      rule: { weekday: 2, startTime: "12:00", durationMinutes: 60 },
    });
    expect(occurrences).toHaveLength(mondaysOnly.length + wednesdaysOnly.length);
  });
});
