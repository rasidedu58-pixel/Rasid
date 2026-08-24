import { describe, expect, it } from "vitest";
import { PRICING_PLANS, TRIAL_DAYS } from "../lib/marketing/pricing-config";

describe("pricing-config", () => {
  it("has exactly one highlighted plan", () => {
    const highlighted = PRICING_PLANS.filter((p) => p.highlighted);
    expect(highlighted).toHaveLength(1);
  });

  it("has exactly one custom (contact-us) tier, with no fixed monthly price", () => {
    const custom = PRICING_PLANS.filter((p) => p.isCustom);
    expect(custom).toHaveLength(1);
    expect(custom[0]?.monthlyPriceEGP).toBeNull();
  });

  it("every non-custom plan has a positive integer monthly price", () => {
    for (const plan of PRICING_PLANS.filter((p) => !p.isCustom)) {
      expect(plan.monthlyPriceEGP).not.toBeNull();
      expect(Number.isInteger(plan.monthlyPriceEGP)).toBe(true);
      expect(plan.monthlyPriceEGP as number).toBeGreaterThan(0);
    }
  });

  it("plan prices are non-decreasing as capacity grows (no cheaper-but-bigger tier)", () => {
    const prices = PRICING_PLANS.filter((p) => !p.isCustom).map((p) => p.monthlyPriceEGP as number);
    for (let i = 1; i < prices.length; i++) {
      expect(prices[i]).toBeGreaterThan(prices[i - 1] as number);
    }
  });

  it("trial length is a positive number of days", () => {
    expect(TRIAL_DAYS).toBeGreaterThan(0);
  });
});
