import { describe, expect, it } from "vitest";
import { assertMonthlyBillingCycle, AnnualBillingNotSupportedError } from "./billing-cycle";

/**
 * V1 commercial policy: MONTHLY ONLY. `assertMonthlyBillingCycle` is the single
 * trust boundary every creation path (new subscription / renewal / upgrade /
 * custom request / custom offer) calls, so proving it here proves the boundary
 * for all of them: ANNUAL (or anything non-monthly) is rejected with a typed
 * 4xx, never silently converted to MONTHLY.
 */
describe("assertMonthlyBillingCycle — MONTHLY-only trust boundary", () => {
  it("accepts MONTHLY", () => {
    expect(() => assertMonthlyBillingCycle("MONTHLY")).not.toThrow();
  });

  it("rejects ANNUAL with a typed ANNUAL_BILLING_NOT_SUPPORTED (never a silent convert)", () => {
    expect(() => assertMonthlyBillingCycle("ANNUAL")).toThrow(AnnualBillingNotSupportedError);
  });

  it("rejects any other non-monthly cycle", () => {
    expect(() => assertMonthlyBillingCycle("WEEKLY")).toThrow(AnnualBillingNotSupportedError);
    expect(() => assertMonthlyBillingCycle("")).toThrow(AnnualBillingNotSupportedError);
  });

  it("the error is a billing-domain error that maps to a 422 (not a raw 500)", () => {
    const err = new AnnualBillingNotSupportedError();
    expect(err.isBillingDomainError).toBe(true);
    expect(err.code).toBe("ANNUAL_BILLING_NOT_SUPPORTED");
    expect(err.httpStatus).toBe(422);
    expect(err.message).toContain("شهرية");
  });
});
