import { describe, expect, it } from "vitest";
import {
  effectivePlanAt,
  hasFutureDifferentPlanPeriod,
  paidThroughMs,
  resolveEffectiveSegments,
  toProrationSlices,
  type LedgerPeriodRow,
} from "./period-ledger";

const DAY = 24 * 60 * 60 * 1000;

function row(over: Partial<LedgerPeriodRow> & Pick<LedgerPeriodRow, "id" | "seq" | "planCode" | "periodStartMs" | "periodEndMs">): LedgerPeriodRow {
  return {
    billingCycle: "MONTHLY",
    cyclePriceMinor: 30000,
    planPriceVersion: 1,
    customMaxActiveStudents: null,
    customMaxTeamMembers: null,
    nominalCycleStartMs: over.periodStartMs,
    nominalCycleEndMs: over.periodEndMs,
    ...over,
  };
}

describe("resolveEffectiveSegments", () => {
  it("returns [] for no rows", () => {
    expect(resolveEffectiveSegments([], 0)).toEqual([]);
  });

  it("a single period yields one clipped segment", () => {
    const rows = [row({ id: "a", seq: 1, planCode: "PROFESSIONAL", periodStartMs: 0, periodEndMs: 30 * DAY })];
    const segs = resolveEffectiveSegments(rows, 10 * DAY);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ planCode: "PROFESSIONAL", startMs: 10 * DAY, endMs: 30 * DAY });
  });

  it("an UPGRADE row wins by higher seq for its overlap, original keeps the earlier slice", () => {
    const rows = [
      row({ id: "orig", seq: 1, planCode: "PROFESSIONAL", periodStartMs: 0, periodEndMs: 30 * DAY, cyclePriceMinor: 30000 }),
      row({
        id: "up",
        seq: 2,
        planCode: "ADVANCED",
        periodStartMs: 15 * DAY,
        periodEndMs: 30 * DAY,
        cyclePriceMinor: 45000,
        nominalCycleStartMs: 0,
        nominalCycleEndMs: 30 * DAY,
      }),
    ];
    const segs = resolveEffectiveSegments(rows, 0);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ planCode: "PROFESSIONAL", startMs: 0, endMs: 15 * DAY });
    expect(segs[1]).toMatchObject({ planCode: "ADVANCED", startMs: 15 * DAY, endMs: 30 * DAY });
    // The upgrade slice keeps the ORIGINAL nominal cycle for exact valuation.
    expect(segs[1]!.nominalCycleStartMs).toBe(0);
    expect(segs[1]!.nominalCycleEndMs).toBe(30 * DAY);
    expect(effectivePlanAt(rows, 10 * DAY)).toBe("PROFESSIONAL");
    expect(effectivePlanAt(rows, 20 * DAY)).toBe("ADVANCED");
  });

  it("stacked renewals produce sequential non-overlapping segments", () => {
    const rows = [
      row({ id: "p1", seq: 1, planCode: "PROFESSIONAL", periodStartMs: 0, periodEndMs: 30 * DAY }),
      row({ id: "p2", seq: 2, planCode: "PROFESSIONAL", periodStartMs: 30 * DAY, periodEndMs: 60 * DAY }),
      row({ id: "p3", seq: 3, planCode: "PROFESSIONAL", periodStartMs: 60 * DAY, periodEndMs: 90 * DAY }),
    ];
    const segs = resolveEffectiveSegments(rows, 0);
    expect(segs.map((s) => [s.startMs / DAY, s.endMs / DAY])).toEqual([
      [0, 30],
      [30, 60],
      [60, 90],
    ]);
    expect(paidThroughMs(rows)).toBe(90 * DAY);
  });

  it("a future downgraded cycle is effective only from its boundary; current plan stays until then", () => {
    const rows = [
      row({ id: "cur", seq: 1, planCode: "ADVANCED", periodStartMs: 0, periodEndMs: 30 * DAY, cyclePriceMinor: 45000 }),
      row({ id: "fut", seq: 2, planCode: "PROFESSIONAL", periodStartMs: 30 * DAY, periodEndMs: 60 * DAY, cyclePriceMinor: 30000 }),
    ];
    expect(effectivePlanAt(rows, 10 * DAY)).toBe("ADVANCED"); // current, unchanged early
    expect(effectivePlanAt(rows, 45 * DAY)).toBe("PROFESSIONAL"); // future cycle
    const segs = resolveEffectiveSegments(rows, 0);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ planCode: "ADVANCED", startMs: 0, endMs: 30 * DAY });
    expect(segs[1]).toMatchObject({ planCode: "PROFESSIONAL", startMs: 30 * DAY, endMs: 60 * DAY });
  });

  it("hasFutureDifferentPlanPeriod: false for same-plan stacked future periods", () => {
    const rows = [
      row({ id: "p1", seq: 1, planCode: "PROFESSIONAL", periodStartMs: 0, periodEndMs: 30 * DAY }),
      row({ id: "p2", seq: 2, planCode: "PROFESSIONAL", periodStartMs: 30 * DAY, periodEndMs: 60 * DAY }),
    ];
    expect(hasFutureDifferentPlanPeriod(rows, 0)).toBe(false);
  });

  it("hasFutureDifferentPlanPeriod: true when a future paid period has a different plan (early-renewed downgrade)", () => {
    const rows = [
      row({ id: "cur", seq: 1, planCode: "ADVANCED", periodStartMs: 0, periodEndMs: 30 * DAY, cyclePriceMinor: 45000 }),
      row({ id: "fut", seq: 2, planCode: "PROFESSIONAL", periodStartMs: 30 * DAY, periodEndMs: 60 * DAY, cyclePriceMinor: 30000 }),
    ];
    expect(hasFutureDifferentPlanPeriod(rows, 0)).toBe(true);
  });

  it("hasFutureDifferentPlanPeriod: false with no rows or only the current period", () => {
    expect(hasFutureDifferentPlanPeriod([], 0)).toBe(false);
    expect(hasFutureDifferentPlanPeriod([row({ id: "a", seq: 1, planCode: "ADVANCED", periodStartMs: 0, periodEndMs: 30 * DAY })], 0)).toBe(false);
  });

  it("toProrationSlices maps segments to proration input", () => {
    const rows = [row({ id: "a", seq: 1, planCode: "PROFESSIONAL", periodStartMs: 0, periodEndMs: 30 * DAY, cyclePriceMinor: 30000 })];
    const slices = toProrationSlices(resolveEffectiveSegments(rows, 0));
    expect(slices).toEqual([
      { billingCycle: "MONTHLY", cyclePriceMinor: 30000, periodStartMs: 0, periodEndMs: 30 * DAY, nominalCycleStartMs: 0, nominalCycleEndMs: 30 * DAY },
    ]);
  });
});
