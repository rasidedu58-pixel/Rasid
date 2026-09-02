import { describe, expect, it } from "vitest";
import {
  createCustomOfferSchema,
  createCustomRequestSchema,
  CustomValidationError,
  isCustomEligible,
  recommendCustom,
  recommendCustomMonthlyMinor,
  recommendCustomTeamMembers,
  shouldSurfaceCustomCta,
  validateCustomOffer,
} from "./billing-custom";

describe("custom eligibility (>3000 only)", () => {
  it("3000 is BUSINESS_PLUS, not custom; 3001 is custom", () => {
    expect(isCustomEligible(3000)).toBe(false);
    expect(isCustomEligible(3001)).toBe(true);
    expect(isCustomEligible(2999)).toBe(false);
    expect(isCustomEligible(10000)).toBe(true);
    expect(isCustomEligible(3000.5)).toBe(false);
  });
  it("CTA surfaces at >=90% of 3000 (2700)", () => {
    expect(shouldSurfaceCustomCta(2699)).toBe(false);
    expect(shouldSurfaceCustomCta(2700)).toBe(true);
    expect(shouldSurfaceCustomCta(3000)).toBe(true);
  });
});

describe("system recommendation — internal, deterministic, integer", () => {
  it("recommendCustomMonthlyMinor bands: +500 students → +100 EGP above BUSINESS_PLUS", () => {
    expect(recommendCustomMonthlyMinor(3001)).toBe(100000); // 1000 EGP
    expect(recommendCustomMonthlyMinor(3500)).toBe(100000);
    expect(recommendCustomMonthlyMinor(3501)).toBe(110000); // 1100
    expect(recommendCustomMonthlyMinor(4000)).toBe(110000);
    expect(recommendCustomMonthlyMinor(4001)).toBe(120000); // 1200
    expect(recommendCustomMonthlyMinor(4500)).toBe(120000);
    expect(recommendCustomMonthlyMinor(10000)).toBe(230000); // 90000 + 14*10000
  });
  it("recommendCustomMonthlyMinor throws below the custom floor", () => {
    expect(() => recommendCustomMonthlyMinor(3000)).toThrow(CustomValidationError);
  });
  it("recommendCustomTeamMembers: ~1 per 200, floor 15", () => {
    expect(recommendCustomTeamMembers(3001)).toBe(16);
    expect(recommendCustomTeamMembers(4000)).toBe(20);
    expect(recommendCustomTeamMembers(10000)).toBe(50);
  });
  it("recommendCustom: MONTHLY-only — recommended price equals the monthly price; flags team above recommendation", () => {
    // Even when a legacy caller passes billingCycle: 'ANNUAL', the recommendation stays monthly (V1 MONTHLY-only).
    const r = recommendCustom({ requestedMaxActiveStudents: 4000, requestedMaxTeamMembers: 30, billingCycle: "ANNUAL" });
    expect(r.eligible).toBe(true);
    expect(r.recommendedMonthlyMinor).toBe(110000);
    expect(r.recommendedPriceMinor).toBe(110000); // monthly, never ×10
    expect((r as Record<string, unknown>).recommendedAnnualMinor).toBeUndefined();
    expect(r.recommendedMaxTeamMembers).toBe(20);
    expect(r.teamAboveRecommendation).toBe(true);
    expect(r.recommendationVersion).toBe(1);
    expect(r.currency).toBe("EGP");
  });
  it("recommendCustom: monthly cycle + team within recommendation not flagged", () => {
    const r = recommendCustom({ requestedMaxActiveStudents: 4000, requestedMaxTeamMembers: 10, billingCycle: "MONTHLY" });
    expect(r.recommendedPriceMinor).toBe(110000);
    expect(r.teamAboveRecommendation).toBe(false);
  });
  it("recommendCustom: not eligible for <=3000", () => {
    const r = recommendCustom({ requestedMaxActiveStudents: 3000, requestedMaxTeamMembers: 5, billingCycle: "MONTHLY" });
    expect(r.eligible).toBe(false);
    expect(r.recommendedPriceMinor).toBe(0);
  });
  it("is deterministic", () => {
    const a = recommendCustom({ requestedMaxActiveStudents: 6300, requestedMaxTeamMembers: 20, billingCycle: "MONTHLY" });
    const b = recommendCustom({ requestedMaxActiveStudents: 6300, requestedMaxTeamMembers: 20, billingCycle: "MONTHLY" });
    expect(a).toEqual(b);
  });
});

describe("validateCustomOffer — admin authorized override", () => {
  const base = { maxActiveStudents: 4000, maxTeamMembers: 20, billingCycle: "MONTHLY" as const, recommendationPriceMinor: 110000 };
  it("accepts a price equal to the recommendation with no reason (diff 0)", () => {
    expect(validateCustomOffer({ ...base, priceMinor: 110000, adjustmentReason: null }).priceDifferenceMinor).toBe(0);
  });
  it("requires a reason when the price differs from the recommendation", () => {
    expect(() => validateCustomOffer({ ...base, priceMinor: 100000, adjustmentReason: null })).toThrow(/CUSTOM_OFFER_PRICE_REASON_REQUIRED/);
    expect(() => validateCustomOffer({ ...base, priceMinor: 100000, adjustmentReason: "  " })).toThrow(/CUSTOM_OFFER_PRICE_REASON_REQUIRED/);
    expect(validateCustomOffer({ ...base, priceMinor: 100000, adjustmentReason: "خصم ولاء" }).priceDifferenceMinor).toBe(-10000);
    expect(validateCustomOffer({ ...base, priceMinor: 130000, adjustmentReason: "دعم إضافي" }).priceDifferenceMinor).toBe(20000);
  });
  it("rejects sub-3000 students / negative team / non-positive price", () => {
    expect(() => validateCustomOffer({ ...base, maxActiveStudents: 3000, priceMinor: 110000, adjustmentReason: null })).toThrow(/CUSTOM_OFFER_LIMIT_INVALID/);
    expect(() => validateCustomOffer({ ...base, maxTeamMembers: -1, priceMinor: 110000, adjustmentReason: null })).toThrow(/CUSTOM_OFFER_LIMIT_INVALID/);
    expect(() => validateCustomOffer({ ...base, priceMinor: 0, adjustmentReason: null })).toThrow(/CUSTOM_OFFER_PRICE_INVALID/);
  });
});

describe("custom request/offer schemas — client trust boundary", () => {
  it("request accepts only capacities + cycle + note; rejects <=3000 and stray price", () => {
    const parsed = createCustomRequestSchema.parse({ requestedMaxActiveStudents: 4000, requestedMaxTeamMembers: 20, preferredBillingCycle: "MONTHLY", priceMinor: 999 } as never);
    expect(parsed).toEqual({ requestedMaxActiveStudents: 4000, requestedMaxTeamMembers: 20, preferredBillingCycle: "MONTHLY" });
    expect(createCustomRequestSchema.safeParse({ requestedMaxActiveStudents: 3000, requestedMaxTeamMembers: 5, preferredBillingCycle: "MONTHLY" }).success).toBe(false);
  });
  it("offer schema defaults effectiveMode IMMEDIATE and validForDays 14", () => {
    const parsed = createCustomOfferSchema.parse({ customRequestId: "11111111-1111-1111-1111-111111111111", maxActiveStudents: 4000, maxTeamMembers: 20, billingCycle: "MONTHLY", priceMinor: 110000 });
    expect(parsed.effectiveMode).toBe("IMMEDIATE");
    expect(parsed.validForDays).toBe(14);
  });
});
