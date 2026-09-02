import { describe, expect, it } from "vitest";
import {
  BILLING_CURRENCY,
  MAX_STANDARD_PLAN_STUDENTS,
  DEFAULT_RENEWAL_PRICE_POLICY,
  capacityThresholdDedupKey,
  resolveCapacityThresholdBand,
  PLAN_CODES,
  PLAN_PRICE_VERSION,
  PlanLimitsResolutionError,
  RENEWAL_PRICE_POLICIES,
  RenewalPriceResolutionError,
  STANDARD_PLANS,
  STANDARD_PLAN_CODES,
  STANDARD_PLAN_LIST,
  TRIAL_LIMITS,
  requiresCustomPlan,
  resolveCatalogPrice,
  resolvePlanLimits,
  resolveRenewalPrice,
  isCreatableBillingCycle,
  CREATABLE_BILLING_CYCLES,
  type StandardPlanCode,
} from "./billing-catalog";

/** The approved V1 pricing table — MONTHLY ONLY (source of truth). */
const EXPECTED: Record<StandardPlanCode, { students: number; team: number; monthly: number }> = {
  STARTER: { students: 100, team: 0, monthly: 10000 },
  GROWTH: { students: 250, team: 1, monthly: 18000 },
  PROFESSIONAL: { students: 500, team: 2, monthly: 30000 },
  ADVANCED: { students: 1000, team: 5, monthly: 45000 },
  BUSINESS: { students: 2000, team: 10, monthly: 70000 },
  BUSINESS_PLUS: { students: 3000, team: 15, monthly: 90000 },
};

describe("Plan Catalog — the six standard plans (MONTHLY only)", () => {
  it.each(STANDARD_PLAN_CODES)("%s matches the approved capacity + monthly price", (code) => {
    const plan = STANDARD_PLANS[code];
    const want = EXPECTED[code];
    expect(plan.maxActiveStudents).toBe(want.students);
    expect(plan.maxTeamMembers).toBe(want.team);
    expect(plan.monthlyPriceMinor).toBe(want.monthly);
    // No annual price exists on the plan (MONTHLY-only policy).
    expect((plan as Record<string, unknown>).annualPriceMinor).toBeUndefined();
  });

  it("sells MONTHLY only — ANNUAL is not a creatable cycle", () => {
    expect([...CREATABLE_BILLING_CYCLES]).toEqual(["MONTHLY"]);
    expect(isCreatableBillingCycle("MONTHLY")).toBe(true);
    expect(isCreatableBillingCycle("ANNUAL")).toBe(false);
  });

  it("keeps every money value a positive integer minor-unit (never a float)", () => {
    for (const code of STANDARD_PLAN_CODES) {
      const plan = STANDARD_PLANS[code];
      expect(Number.isInteger(plan.monthlyPriceMinor)).toBe(true);
      expect(plan.monthlyPriceMinor).toBeGreaterThan(0);
    }
  });

  it("marks only PROFESSIONAL with a badge, and never with a popularity claim", () => {
    for (const code of STANDARD_PLAN_CODES) {
      const badge = STANDARD_PLANS[code].badgeAr;
      if (code === "PROFESSIONAL") expect(badge).toBe("الأنسب لمعظم المدرّسين");
      else expect(badge).toBeNull();
      if (badge) expect(badge).not.toMatch(/الأكثر/);
    }
  });

  it("lists the plans in order and separates CUSTOM from the standard codes", () => {
    expect(STANDARD_PLAN_LIST.map((p) => p.code)).toEqual([...STANDARD_PLAN_CODES]);
    expect(PLAN_CODES).toContain("CUSTOM");
    expect(STANDARD_PLAN_CODES).not.toContain("CUSTOM" as never);
  });
});

describe("resolveCatalogPrice", () => {
  it("returns the MONTHLY catalog price tagged with the current version", () => {
    expect(resolveCatalogPrice("STARTER", "MONTHLY")).toEqual({ amountMinor: 10000, currency: BILLING_CURRENCY, planPriceVersion: PLAN_PRICE_VERSION });
    expect(resolveCatalogPrice("PROFESSIONAL", "MONTHLY")).toEqual({ amountMinor: 30000, currency: "EGP", planPriceVersion: PLAN_PRICE_VERSION });
  });

  it("has NO annual catalog price (MONTHLY-only) — annual resolves to null so no trusted flow can price it", () => {
    expect(resolveCatalogPrice("STARTER", "ANNUAL")).toBeNull();
    expect(resolveCatalogPrice("PROFESSIONAL", "ANNUAL")).toBeNull();
  });

  it("has no catalog price for CUSTOM (negotiated per offer)", () => {
    expect(resolveCatalogPrice("CUSTOM", "MONTHLY")).toBeNull();
    expect(resolveCatalogPrice("CUSTOM", "ANNUAL")).toBeNull();
  });
});

describe("resolvePlanLimits", () => {
  it("gives a live TRIAL the trial capacity regardless of plan_code", () => {
    expect(resolvePlanLimits({ subscriptionState: "TRIAL", planCode: null, customMaxActiveStudents: null, customMaxTeamMembers: null })).toEqual({ maxActiveStudents: 500, maxTeamMembers: 2 });
    // Trial wins even if a stray plan_code is present.
    expect(resolvePlanLimits({ subscriptionState: "TRIAL", planCode: "STARTER", customMaxActiveStudents: null, customMaxTeamMembers: null })).toEqual({ maxActiveStudents: 500, maxTeamMembers: 2 });
  });

  it("resolves a standard paid plan from the catalog", () => {
    expect(resolvePlanLimits({ subscriptionState: "ACTIVE", planCode: "STARTER", customMaxActiveStudents: null, customMaxTeamMembers: null })).toEqual({ maxActiveStudents: 100, maxTeamMembers: 0 });
    expect(resolvePlanLimits({ subscriptionState: "ACTIVE", planCode: "BUSINESS_PLUS", customMaxActiveStudents: null, customMaxTeamMembers: null })).toEqual({ maxActiveStudents: 3000, maxTeamMembers: 15 });
  });

  it("retains the paid plan's limits for display after it EXPIRES", () => {
    expect(resolvePlanLimits({ subscriptionState: "EXPIRED", planCode: "PROFESSIONAL", customMaxActiveStudents: null, customMaxTeamMembers: null })).toEqual({ maxActiveStudents: 500, maxTeamMembers: 2 });
  });

  it("resolves a CUSTOM subscription from its own stored limits", () => {
    expect(resolvePlanLimits({ subscriptionState: "ACTIVE", planCode: "CUSTOM", customMaxActiveStudents: 4200, customMaxTeamMembers: 20 })).toEqual({ maxActiveStudents: 4200, maxTeamMembers: 20 });
  });

  it("throws a typed CUSTOM_LIMITS_MISSING error on a CUSTOM subscription missing its stored limits", () => {
    try {
      resolvePlanLimits({ subscriptionState: "ACTIVE", planCode: "CUSTOM", customMaxActiveStudents: null, customMaxTeamMembers: null });
      throw new Error("expected a throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PlanLimitsResolutionError);
      expect((err as PlanLimitsResolutionError).reason).toBe("CUSTOM_LIMITS_MISSING");
    }
  });

  it("NEVER silently returns trial limits for a non-TRIAL state without a plan — it throws UNMAPPED_LEGACY_SUBSCRIPTION", () => {
    for (const state of ["ACTIVE", "EXPIRING", "EXPIRED", "PAYMENT_FAILED", "CANCELLED_AT_PERIOD_END"] as const) {
      try {
        resolvePlanLimits({ subscriptionState: state, planCode: null, customMaxActiveStudents: null, customMaxTeamMembers: null });
        throw new Error(`expected a throw for state ${state}`);
      } catch (err) {
        expect(err).toBeInstanceOf(PlanLimitsResolutionError);
        expect((err as PlanLimitsResolutionError).reason).toBe("UNMAPPED_LEGACY_SUBSCRIPTION");
        expect((err as PlanLimitsResolutionError).subscriptionState).toBe(state);
      }
    }
  });
});

describe("resolveRenewalPrice", () => {
  it("defaults to KEEP_CURRENT_PRICE in V1", () => {
    expect(DEFAULT_RENEWAL_PRICE_POLICY).toBe("KEEP_CURRENT_PRICE");
    expect(RENEWAL_PRICE_POLICIES).toEqual(["KEEP_CURRENT_PRICE", "USE_CURRENT_CATALOG_PRICE"]);
  });

  it("KEEP_CURRENT_PRICE returns the subscription's locked snapshot (grandfathered)", () => {
    // Snapshot deliberately differs from the current catalog price to prove no re-pricing.
    expect(
      resolveRenewalPrice({ policy: "KEEP_CURRENT_PRICE", planCode: "PROFESSIONAL", billingCycle: "MONTHLY", currentPriceMinor: 25000, currentPriceCurrency: "EGP", currentPlanPriceVersion: 1 }),
    ).toEqual({ amountMinor: 25000, currency: "EGP", planPriceVersion: 1, source: "SUBSCRIPTION_SNAPSHOT" });
  });

  it("USE_CURRENT_CATALOG_PRICE re-prices from the catalog at the current version", () => {
    expect(
      resolveRenewalPrice({ policy: "USE_CURRENT_CATALOG_PRICE", planCode: "PROFESSIONAL", billingCycle: "MONTHLY", currentPriceMinor: 25000, currentPriceCurrency: "EGP", currentPlanPriceVersion: 1 }),
    ).toEqual({ amountMinor: 30000, currency: "EGP", planPriceVersion: PLAN_PRICE_VERSION, source: "CURRENT_CATALOG" });
  });

  it("keeps a CUSTOM deal at its agreed snapshot regardless of policy", () => {
    for (const policy of RENEWAL_PRICE_POLICIES) {
      expect(
        resolveRenewalPrice({ policy, planCode: "CUSTOM", billingCycle: "MONTHLY", currentPriceMinor: 1234500, currentPriceCurrency: "EGP", currentPlanPriceVersion: null }),
      ).toEqual({ amountMinor: 1234500, currency: "EGP", planPriceVersion: null, source: "SUBSCRIPTION_SNAPSHOT" });
    }
  });

  it("throws MISSING_PRICE_SNAPSHOT when KEEP is asked but no price is locked", () => {
    try {
      resolveRenewalPrice({ policy: "KEEP_CURRENT_PRICE", planCode: "STARTER", billingCycle: "MONTHLY", currentPriceMinor: null, currentPriceCurrency: null, currentPlanPriceVersion: null });
      throw new Error("expected a throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RenewalPriceResolutionError);
      expect((err as RenewalPriceResolutionError).reason).toBe("MISSING_PRICE_SNAPSHOT");
    }
  });

  it("throws NO_CATALOG_PRICE when catalog re-pricing is asked for an unpriceable plan", () => {
    try {
      resolveRenewalPrice({ policy: "USE_CURRENT_CATALOG_PRICE", planCode: null, billingCycle: null, currentPriceMinor: null, currentPriceCurrency: null, currentPlanPriceVersion: null });
      throw new Error("expected a throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RenewalPriceResolutionError);
      expect((err as RenewalPriceResolutionError).reason).toBe("NO_CATALOG_PRICE");
    }
  });
});

describe("custom threshold", () => {
  it("treats strictly more than 3000 active students as CUSTOM-only (3000 stays BUSINESS_PLUS)", () => {
    expect(MAX_STANDARD_PLAN_STUDENTS).toBe(3000);
    expect(STANDARD_PLANS.BUSINESS_PLUS.maxActiveStudents).toBe(3000);
    expect(requiresCustomPlan(2999)).toBe(false);
    expect(requiresCustomPlan(3000)).toBe(false);
    expect(requiresCustomPlan(3001)).toBe(true);
  });

  it("keeps TRIAL_LIMITS at the documented 500 / 2", () => {
    expect(TRIAL_LIMITS).toEqual({ maxActiveStudents: 500, maxTeamMembers: 2 });
  });
});

describe("capacity threshold detection", () => {
  it("returns the highest band crossed (90 / 95 / 100), null below 90%", () => {
    expect(resolveCapacityThresholdBand(449, 500)).toBeNull(); // 89.8%
    expect(resolveCapacityThresholdBand(450, 500)).toBe(90); // exactly 90%
    expect(resolveCapacityThresholdBand(474, 500)).toBe(90); // 94.8%
    expect(resolveCapacityThresholdBand(475, 500)).toBe(95); // exactly 95%
    expect(resolveCapacityThresholdBand(499, 500)).toBe(95);
    expect(resolveCapacityThresholdBand(500, 500)).toBe(100); // at limit
    expect(resolveCapacityThresholdBand(520, 500)).toBe(100); // over (defensive)
  });

  it("returns null for a non-positive limit (avoids divide-by-zero)", () => {
    expect(resolveCapacityThresholdBand(0, 0)).toBeNull();
    expect(resolveCapacityThresholdBand(5, 0)).toBeNull();
  });

  it("builds a stable per-workspace/period/band dedup key so it fires at most once per band", () => {
    expect(capacityThresholdDedupKey("STUDENTS", "month-123", 90)).toBe("capacity:STUDENTS:month-123:90");
    expect(capacityThresholdDedupKey("TEAM", "team", 100)).toBe("capacity:TEAM:team:100");
    // Same inputs → same key (dedup); different band → different key.
    expect(capacityThresholdDedupKey("STUDENTS", "month-123", 95)).not.toBe(capacityThresholdDedupKey("STUDENTS", "month-123", 90));
  });
});
