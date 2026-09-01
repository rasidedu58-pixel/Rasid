import { describe, expect, it } from "vitest";
import {
  assertDowngradeTransition,
  assertUpgradeTransition,
  compareStandardPlans,
  computeUpgradeProration,
  computeUpgradeProrationOverPeriods,
  evaluateDowngradeUsage,
  floorToWholeEgpMinor,
  isDowngrade,
  isStandardPlanCode,
  isUpgrade,
  PlanChangeValidationError,
  type ProrationPeriodSlice,
  type UpgradeProrationInput,
} from "./billing-plan-changes";

const DAY = 24 * 60 * 60 * 1000;

describe("plan ordering / comparison", () => {
  it("orders STARTER < GROWTH < PROFESSIONAL < ADVANCED < BUSINESS < BUSINESS_PLUS", () => {
    expect(compareStandardPlans("STARTER", "GROWTH")).toBe(-1);
    expect(compareStandardPlans("PROFESSIONAL", "PROFESSIONAL")).toBe(0);
    expect(compareStandardPlans("BUSINESS_PLUS", "STARTER")).toBe(1);
    expect(compareStandardPlans("ADVANCED", "BUSINESS")).toBe(-1);
  });

  it("isUpgrade / isDowngrade are strict and standard-only", () => {
    expect(isUpgrade("PROFESSIONAL", "ADVANCED")).toBe(true);
    expect(isUpgrade("ADVANCED", "PROFESSIONAL")).toBe(false);
    expect(isUpgrade("PROFESSIONAL", "PROFESSIONAL")).toBe(false);
    expect(isDowngrade("ADVANCED", "PROFESSIONAL")).toBe(true);
    expect(isDowngrade("PROFESSIONAL", "ADVANCED")).toBe(false);
    // CUSTOM / junk never compares as up/down
    expect(isUpgrade("CUSTOM", "ADVANCED")).toBe(false);
    expect(isDowngrade("ADVANCED", "CUSTOM")).toBe(false);
    expect(isUpgrade("PROFESSIONAL", "NONSENSE" as never)).toBe(false);
  });

  it("isStandardPlanCode excludes CUSTOM and junk", () => {
    expect(isStandardPlanCode("PROFESSIONAL")).toBe(true);
    expect(isStandardPlanCode("CUSTOM")).toBe(false);
    expect(isStandardPlanCode("nope")).toBe(false);
    expect(isStandardPlanCode(null)).toBe(false);
  });

  it("compareStandardPlans throws on non-standard", () => {
    expect(() => compareStandardPlans("CUSTOM" as never, "ADVANCED")).toThrow(PlanChangeValidationError);
  });
});

describe("assertUpgradeTransition", () => {
  it("accepts a genuine upgrade", () => {
    expect(() => assertUpgradeTransition("PROFESSIONAL", "ADVANCED")).not.toThrow();
  });
  it("rejects same / downgrade / custom / invalid with typed reasons", () => {
    expect(() => assertUpgradeTransition("PROFESSIONAL", "PROFESSIONAL")).toThrow(/SAME_PLAN/);
    expect(() => assertUpgradeTransition("ADVANCED", "PROFESSIONAL")).toThrow(/NOT_AN_UPGRADE/);
    expect(() => assertUpgradeTransition("PROFESSIONAL", "CUSTOM")).toThrow(/CUSTOM_OUT_OF_SCOPE/);
    expect(() => assertUpgradeTransition("CUSTOM", "ADVANCED")).toThrow(/CUSTOM_OUT_OF_SCOPE/);
    expect(() => assertUpgradeTransition("PROFESSIONAL", "junk" as never)).toThrow(/INVALID_PLAN/);
  });
});

describe("assertDowngradeTransition", () => {
  it("accepts a genuine downgrade", () => {
    expect(() => assertDowngradeTransition("ADVANCED", "PROFESSIONAL")).not.toThrow();
  });
  it("rejects same / upgrade / custom with typed reasons", () => {
    expect(() => assertDowngradeTransition("PROFESSIONAL", "PROFESSIONAL")).toThrow(/SAME_PLAN/);
    expect(() => assertDowngradeTransition("PROFESSIONAL", "ADVANCED")).toThrow(/NOT_A_DOWNGRADE/);
    expect(() => assertDowngradeTransition("ADVANCED", "CUSTOM")).toThrow(/CUSTOM_OUT_OF_SCOPE/);
  });
});

describe("floorToWholeEgpMinor", () => {
  it("floors minor units down to a whole EGP (multiple of 100)", () => {
    expect(floorToWholeEgpMinor(11387n)).toBe(11300n);
    expect(floorToWholeEgpMinor(4285n)).toBe(4200n);
    expect(floorToWholeEgpMinor(7500n)).toBe(7500n);
    expect(floorToWholeEgpMinor(99n)).toBe(0n);
  });
});

// PROFESSIONAL(30000) → ADVANCED(45000): per-cycle difference = 15000 minor (150 EGP).
const base = (over: Partial<UpgradeProrationInput> = {}): UpgradeProrationInput => ({
  currentPlan: "PROFESSIONAL",
  targetPlan: "ADVANCED",
  billingCycle: "MONTHLY",
  currentPriceMinorSnapshot: 30000,
  targetCatalogPriceMinor: 45000,
  periodStartMs: 0,
  periodEndMs: 30 * DAY,
  nowMs: 0,
  ...over,
});

describe("computeUpgradeProration — same-cycle, single stored cycle (exact)", () => {
  it("start of cycle → full price difference (ratio = 1)", () => {
    const r = computeUpgradeProration(base({ nowMs: 0 }));
    expect(r.kind).toBe("DUE");
    if (r.kind !== "DUE") return;
    expect(r.amountDueMinor).toBe(15000); // 150 EGP
    expect(r.normalTargetPriceMinor).toBe(45000);
  });

  it("midpoint → half the difference", () => {
    const r = computeUpgradeProration(base({ nowMs: 15 * DAY }));
    expect(r.kind).toBe("DUE");
    if (r.kind !== "DUE") return;
    expect(r.amountDueMinor).toBe(7500); // 75 EGP
    expect(r.creditRemainingMinor).toBe(15000); // half of 30000
    expect(r.targetRemainingCostMinor).toBe(22500); // half of 45000
  });

  it("near end → small proration", () => {
    const r = computeUpgradeProration(base({ nowMs: 29 * DAY })); // 1 day left of 30
    expect(r.kind).toBe("DUE");
    if (r.kind !== "DUE") return;
    expect(r.amountDueMinor).toBe(500); // floor(15000/30)=500 → 5 EGP
  });

  it("floors the charge DOWN to whole EGP in the customer's favour", () => {
    // diff=10000, remaining=3, cycle=7 → raw = floor(10000*3/7)=4285 → EGP-floor → 4200
    const r = computeUpgradeProration(
      base({ currentPriceMinorSnapshot: 35000, targetCatalogPriceMinor: 45000, periodStartMs: 0, periodEndMs: 7, nowMs: 4 }),
    );
    expect(r.kind).toBe("DUE");
    if (r.kind !== "DUE") return;
    expect(r.amountDueMinor).toBe(4200);
  });

  it("uses the LOCKED current-price snapshot, not the current plan's catalog price", () => {
    // Customer locked PROFESSIONAL at an OLD 25000; upgrading to ADVANCED@45000 → diff 20000 (not 15000).
    const r = computeUpgradeProration(base({ currentPriceMinorSnapshot: 25000, nowMs: 0 }));
    expect(r.kind).toBe("DUE");
    if (r.kind !== "DUE") return;
    expect(r.amountDueMinor).toBe(20000);
  });

  it("is deterministic for identical inputs", () => {
    const a = computeUpgradeProration(base({ nowMs: 11 * DAY }));
    const b = computeUpgradeProration(base({ nowMs: 11 * DAY }));
    expect(a).toEqual(b);
  });

  it("annual same-cycle prorates over the annual period", () => {
    // PROFESSIONAL annual 300000 → ADVANCED annual 450000, diff 150000, half a year left.
    const r = computeUpgradeProration({
      currentPlan: "PROFESSIONAL",
      targetPlan: "ADVANCED",
      billingCycle: "ANNUAL",
      currentPriceMinorSnapshot: 300000,
      targetCatalogPriceMinor: 450000,
      periodStartMs: 0,
      periodEndMs: 365 * DAY,
      nowMs: Math.floor(182.5 * DAY),
    });
    expect(r.kind).toBe("DUE");
    if (r.kind !== "DUE") return;
    expect(r.amountDueMinor).toBe(75000); // ~half of 150000, EGP-floored
  });
});

describe("computeUpgradeProration — boundary / non-positive / no-time", () => {
  it("returns NON_POSITIVE when the difference over remaining time floors to 0", () => {
    const r = computeUpgradeProration(base({ periodEndMs: 1_000_000_000, nowMs: 1_000_000_000 - 1 }));
    expect(r.kind).toBe("NON_POSITIVE");
  });

  it("returns NON_POSITIVE for a zero/negative difference", () => {
    const r = computeUpgradeProration(base({ currentPriceMinorSnapshot: 45000, targetCatalogPriceMinor: 45000 }));
    expect(r.kind).toBe("NON_POSITIVE");
  });

  it("returns NO_REMAINING_TIME at/after period_end", () => {
    expect(computeUpgradeProration(base({ nowMs: 30 * DAY })).kind).toBe("NO_REMAINING_TIME");
    expect(computeUpgradeProration(base({ nowMs: 31 * DAY })).kind).toBe("NO_REMAINING_TIME");
  });
});

describe("computeUpgradeProration — stacked early renewals need the period ledger", () => {
  it("returns REQUIRES_PERIOD_LEDGER when now precedes period_start (remaining > one stored cycle)", () => {
    // Early-renewed: current stored cycle is [Nov 1 .. Dec 1] but paid-through is far; now = Oct 15 (< period_start).
    const r = computeUpgradeProration(base({ periodStartMs: 17 * DAY, periodEndMs: 47 * DAY, nowMs: 0 }));
    expect(r.kind).toBe("REQUIRES_PERIOD_LEDGER");
    if (r.kind !== "REQUIRES_PERIOD_LEDGER") return;
    expect(r.reason).toBe("MULTI_CYCLE_PREPAID");
  });
});

// A full-cycle monthly period slice tiled at [start, start+30d].
const monthlySlice = (startDay: number, rate: number): ProrationPeriodSlice => ({
  billingCycle: "MONTHLY",
  cyclePriceMinor: rate,
  periodStartMs: startDay * DAY,
  periodEndMs: (startDay + 30) * DAY,
  nominalCycleStartMs: startDay * DAY,
  nominalCycleEndMs: (startDay + 30) * DAY,
});

describe("computeUpgradeProrationOverPeriods — the ledger-exact algorithm", () => {
  it("single full current period equals the single-cycle helper", () => {
    const r = computeUpgradeProrationOverPeriods({
      targetPlan: "ADVANCED",
      billingCycle: "MONTHLY",
      targetCatalogPriceMinor: 45000,
      nowMs: 15 * DAY,
      periods: [monthlySlice(0, 30000)],
    });
    expect(r.kind).toBe("DUE");
    if (r.kind !== "DUE") return;
    expect(r.amountDueMinor).toBe(7500);
  });

  it("stacked early renewals: 3 prepaid PROFESSIONAL periods → sum of all three differences", () => {
    // now = 0 (start of period 1); all three fully remaining. diff 15000 each → 45000.
    const r = computeUpgradeProrationOverPeriods({
      targetPlan: "ADVANCED",
      billingCycle: "MONTHLY",
      targetCatalogPriceMinor: 45000,
      nowMs: 0,
      periods: [monthlySlice(0, 30000), monthlySlice(30, 30000), monthlySlice(60, 30000)],
    });
    expect(r.kind).toBe("DUE");
    if (r.kind !== "DUE") return;
    expect(r.amountDueMinor).toBe(45000);
    expect(r.creditRemainingMinor).toBe(90000); // 3 × 30000
    expect(r.targetRemainingCostMinor).toBe(135000); // 3 × 45000
  });

  it("partial first period + full future periods", () => {
    // now = 15d into period 1 → half of P1 (7500) + full P2 (15000) + full P3 (15000) = 37500.
    const r = computeUpgradeProrationOverPeriods({
      targetPlan: "ADVANCED",
      billingCycle: "MONTHLY",
      targetCatalogPriceMinor: 45000,
      nowMs: 15 * DAY,
      periods: [monthlySlice(0, 30000), monthlySlice(30, 30000), monthlySlice(60, 30000)],
    });
    expect(r.kind).toBe("DUE");
    if (r.kind !== "DUE") return;
    expect(r.amountDueMinor).toBe(37500);
  });

  it("periods locked at DIFFERENT historical prices are each credited at their own rate", () => {
    // P1 locked 30000, P2 locked at an OLD 25000; target 45000, now=0 → 15000 + 20000 = 35000.
    const r = computeUpgradeProrationOverPeriods({
      targetPlan: "ADVANCED",
      billingCycle: "MONTHLY",
      targetCatalogPriceMinor: 45000,
      nowMs: 0,
      periods: [monthlySlice(0, 30000), monthlySlice(30, 25000)],
    });
    expect(r.kind).toBe("DUE");
    if (r.kind !== "DUE") return;
    expect(r.amountDueMinor).toBe(35000);
  });

  it("annual periods prorate over the annual nominal cycle", () => {
    const r = computeUpgradeProrationOverPeriods({
      targetPlan: "ADVANCED",
      billingCycle: "ANNUAL",
      targetCatalogPriceMinor: 450000,
      nowMs: Math.floor(182.5 * DAY),
      periods: [
        {
          billingCycle: "ANNUAL",
          cyclePriceMinor: 300000,
          periodStartMs: 0,
          periodEndMs: 365 * DAY,
          nominalCycleStartMs: 0,
          nominalCycleEndMs: 365 * DAY,
        },
      ],
    });
    expect(r.kind).toBe("DUE");
    if (r.kind !== "DUE") return;
    expect(r.amountDueMinor).toBe(75000); // ~half of 150000
  });

  it("rejects a slice whose cycle differs from the target cycle (cross-cycle out of scope)", () => {
    const r = computeUpgradeProrationOverPeriods({
      targetPlan: "ADVANCED",
      billingCycle: "MONTHLY",
      targetCatalogPriceMinor: 45000,
      nowMs: 0,
      periods: [{ ...monthlySlice(0, 30000), billingCycle: "ANNUAL" }],
    });
    expect(r.kind).toBe("NOT_SAME_CYCLE");
  });

  it("NON_POSITIVE when the target is not above the locked rate anywhere", () => {
    const r = computeUpgradeProrationOverPeriods({
      targetPlan: "ADVANCED",
      billingCycle: "MONTHLY",
      targetCatalogPriceMinor: 30000,
      nowMs: 0,
      periods: [monthlySlice(0, 30000)],
    });
    expect(r.kind).toBe("NON_POSITIVE");
  });

  it("NO_REMAINING_TIME when every period has already ended", () => {
    const r = computeUpgradeProrationOverPeriods({
      targetPlan: "ADVANCED",
      billingCycle: "MONTHLY",
      targetCatalogPriceMinor: 45000,
      nowMs: 100 * DAY,
      periods: [monthlySlice(0, 30000), monthlySlice(30, 30000)],
    });
    expect(r.kind).toBe("NO_REMAINING_TIME");
  });

  it("is deterministic", () => {
    const input = {
      targetPlan: "ADVANCED" as const,
      billingCycle: "MONTHLY" as const,
      targetCatalogPriceMinor: 45000,
      nowMs: 7 * DAY,
      periods: [monthlySlice(0, 30000), monthlySlice(30, 30000)],
    };
    expect(computeUpgradeProrationOverPeriods(input)).toEqual(computeUpgradeProrationOverPeriods(input));
  });
});

describe("evaluateDowngradeUsage", () => {
  it("ALLOWs when usage fits the target plan", () => {
    const d = evaluateDowngradeUsage({ targetPlan: "PROFESSIONAL", currentActiveStudents: 400, currentActiveTeamMembers: 1 });
    expect(d.decision).toBe("ALLOW");
    expect(d.studentsOverBy).toBe(0);
    expect(d.teamOverBy).toBe(0);
  });

  it("BLOCKED_BY_USAGE with exact overflow details when students exceed target", () => {
    const d = evaluateDowngradeUsage({ targetPlan: "PROFESSIONAL", currentActiveStudents: 612, currentActiveTeamMembers: 1 });
    expect(d.decision).toBe("BLOCKED_BY_USAGE");
    expect(d.targetStudentLimit).toBe(500);
    expect(d.studentsOverBy).toBe(112);
    expect(d.teamOverBy).toBe(0);
  });

  it("BLOCKED_BY_USAGE when team exceeds target", () => {
    const d = evaluateDowngradeUsage({ targetPlan: "STARTER", currentActiveStudents: 50, currentActiveTeamMembers: 1 });
    expect(d.decision).toBe("BLOCKED_BY_USAGE");
    expect(d.targetTeamLimit).toBe(0);
    expect(d.teamOverBy).toBe(1);
  });

  it("reports both overflows together", () => {
    const d = evaluateDowngradeUsage({ targetPlan: "PROFESSIONAL", currentActiveStudents: 700, currentActiveTeamMembers: 5 });
    expect(d.decision).toBe("BLOCKED_BY_USAGE");
    expect(d.studentsOverBy).toBe(200);
    expect(d.teamOverBy).toBe(3);
  });
});
