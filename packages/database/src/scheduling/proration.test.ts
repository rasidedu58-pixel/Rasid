import { describe, expect, it } from "vitest";
import { PRORATION_UNAVAILABLE, computeProration, type ProrationSessionInput } from "./proration";

const CAIRO = "Africa/Cairo";

function session(overrides: Partial<ProrationSessionInput> & { scheduledAt: Date }): ProrationSessionInput {
  return {
    status: "SCHEDULED",
    billableForProration: true,
    ...overrides,
  };
}

describe("computeProration", () => {
  it("matches the PRD AC-07 worked example exactly (60000 base, 3 eligible of 8 billable -> 22500)", () => {
    const sessions: ProrationSessionInput[] = [
      // 5 sessions before the join date (not eligible)...
      ...Array.from({ length: 5 }, (_, i) => session({ scheduledAt: new Date(Date.UTC(2026, 7, 1 + i, 8, 0, 0)) })),
      // ...and 3 on/after it.
      ...Array.from({ length: 3 }, (_, i) => session({ scheduledAt: new Date(Date.UTC(2026, 7, 15 + i, 8, 0, 0)) })),
    ];
    const result = computeProration({
      baseFeeMinor: 60000,
      joinDate: "2026-08-15",
      workspaceTimezone: CAIRO,
      sessions,
    });
    expect(result).not.toBe(PRORATION_UNAVAILABLE);
    if (result === PRORATION_UNAVAILABLE) throw new Error("unreachable");
    expect(result.totalBillableSessions).toBe(8);
    expect(result.eligibleSessions).toBe(3);
    expect(result.calculatedDueMinor).toBe(22500);
    expect(result.formula).toBe("REMAINING_SESSIONS");
    expect(result.rounding).toBe("HALF_UP_FINAL_MINOR_UNIT");
  });

  it("rounds half-up at a .5 boundary — differs from banker's round-half-to-even", () => {
    // base=1, eligible=1, total=2 -> raw 0.5. Half-up -> 1. Banker's
    // rounding (round half to even) would give 0 here, since 0 is even.
    const sessions: ProrationSessionInput[] = [
      session({ scheduledAt: new Date("2026-08-05T08:00:00Z") }), // eligible
      session({ scheduledAt: new Date("2026-08-01T08:00:00Z") }), // not eligible
    ];
    const result = computeProration({
      baseFeeMinor: 1,
      joinDate: "2026-08-05",
      workspaceTimezone: CAIRO,
      sessions,
    });
    if (result === PRORATION_UNAVAILABLE) throw new Error("unreachable");
    expect(result.calculatedDueMinor).toBe(1); // half-up, not banker's 0

    // base=5, eligible=1, total=2 -> raw 2.5 -> half-up 3. Banker's rounding
    // would ALSO give 2 here (2 is even) — distinct from half-up's 3.
    const result2 = computeProration({
      baseFeeMinor: 5,
      joinDate: "2026-08-05",
      workspaceTimezone: CAIRO,
      sessions,
    });
    if (result2 === PRORATION_UNAVAILABLE) throw new Error("unreachable");
    expect(result2.calculatedDueMinor).toBe(3);
  });

  it("excludes CANCELLED sessions from both the total and the eligible count", () => {
    const sessions: ProrationSessionInput[] = [
      session({ scheduledAt: new Date("2026-08-10T08:00:00Z"), status: "CANCELLED" }),
      session({ scheduledAt: new Date("2026-08-12T08:00:00Z") }),
    ];
    const result = computeProration({
      baseFeeMinor: 1000,
      joinDate: "2026-08-01",
      workspaceTimezone: CAIRO,
      sessions,
    });
    if (result === PRORATION_UNAVAILABLE) throw new Error("unreachable");
    expect(result.totalBillableSessions).toBe(1);
    expect(result.eligibleSessions).toBe(1);
  });

  it("excludes a RESCHEDULED original but includes its SCHEDULED replacement — the pair counts once", () => {
    const sessions: ProrationSessionInput[] = [
      // Original, superseded — excluded.
      session({ scheduledAt: new Date("2026-08-10T08:00:00Z"), status: "RESCHEDULED" }),
      // Its replacement — the only one of the pair that counts.
      session({ scheduledAt: new Date("2026-08-14T08:00:00Z"), status: "SCHEDULED" }),
      session({ scheduledAt: new Date("2026-08-20T08:00:00Z"), status: "SCHEDULED" }),
    ];
    const result = computeProration({
      baseFeeMinor: 3000,
      joinDate: "2026-08-01",
      workspaceTimezone: CAIRO,
      sessions,
    });
    if (result === PRORATION_UNAVAILABLE) throw new Error("unreachable");
    expect(result.totalBillableSessions).toBe(2);
  });

  it("excludes a MANUAL (non-billable) session", () => {
    const sessions: ProrationSessionInput[] = [
      session({ scheduledAt: new Date("2026-08-10T08:00:00Z"), billableForProration: false }),
      session({ scheduledAt: new Date("2026-08-12T08:00:00Z"), billableForProration: true }),
    ];
    const result = computeProration({
      baseFeeMinor: 1000,
      joinDate: "2026-08-01",
      workspaceTimezone: CAIRO,
      sessions,
    });
    if (result === PRORATION_UNAVAILABLE) throw new Error("unreachable");
    expect(result.totalBillableSessions).toBe(1);
  });

  it("includes a MANUAL session explicitly marked billable_for_proration=true", () => {
    const sessions: ProrationSessionInput[] = [
      session({ scheduledAt: new Date("2026-08-10T08:00:00Z"), billableForProration: true }),
    ];
    const result = computeProration({
      baseFeeMinor: 1000,
      joinDate: "2026-08-01",
      workspaceTimezone: CAIRO,
      sessions,
    });
    if (result === PRORATION_UNAVAILABLE) throw new Error("unreachable");
    expect(result.totalBillableSessions).toBe(1);
    expect(result.eligibleSessions).toBe(1);
  });

  it("returns the UNAVAILABLE sentinel when there are zero billable sessions", () => {
    const sessions: ProrationSessionInput[] = [
      session({ scheduledAt: new Date("2026-08-10T08:00:00Z"), status: "CANCELLED" }),
      session({ scheduledAt: new Date("2026-08-12T08:00:00Z"), billableForProration: false }),
    ];
    const result = computeProration({
      baseFeeMinor: 1000,
      joinDate: "2026-08-01",
      workspaceTimezone: CAIRO,
      sessions,
    });
    expect(result).toBe(PRORATION_UNAVAILABLE);
  });

  it("join-date exactly on a session's calendar day is eligible (same-day)", () => {
    // Session at 06:00 UTC on 2026-08-15 = 08:00 Africa/Cairo (UTC+2 in
    // August), same calendar day as the join date.
    const sessions: ProrationSessionInput[] = [
      session({ scheduledAt: new Date("2026-08-15T06:00:00Z") }),
    ];
    const result = computeProration({
      baseFeeMinor: 1000,
      joinDate: "2026-08-15",
      workspaceTimezone: CAIRO,
      sessions,
    });
    if (result === PRORATION_UNAVAILABLE) throw new Error("unreachable");
    expect(result.eligibleSessions).toBe(1);
  });

  it("a session one calendar day before the join date is excluded", () => {
    const sessions: ProrationSessionInput[] = [
      session({ scheduledAt: new Date("2026-08-14T06:00:00Z") }), // 2026-08-14 local
    ];
    const result = computeProration({
      baseFeeMinor: 1000,
      joinDate: "2026-08-15",
      workspaceTimezone: CAIRO,
      sessions,
    });
    if (result === PRORATION_UNAVAILABLE) throw new Error("unreachable");
    expect(result.eligibleSessions).toBe(0);
  });
});
