import { describe, expect, it } from "vitest";
import {
  HUMAN_CODE_ALPHABET,
  PaymentRequestExpiredError,
  PaymentRequestNotPendingError,
  PaymentRequestStaleError,
  PlanChangeNotSupportedError,
  computeConfirmedPeriod,
  computePeriodEnd,
  customRenewalPlanPriceVersion,
  generateHumanCode,
} from "./payment-requests.repository";

/**
 * Pure-logic unit tests. The transactional flows (create/confirm/reject,
 * race-safety, idempotency, RLS) are proven against real Postgres in
 * `payment-flow.integration.test.ts`; here we pin the date policy, the human
 * code format, and the error contract.
 */

describe("computePeriodEnd — calendar-month policy (deterministic, no 30/365 fixed)", () => {
  it("MONTHLY adds exactly one calendar month", () => {
    expect(computePeriodEnd(new Date("2026-03-15T10:00:00Z"), "MONTHLY").toISOString()).toBe("2026-04-15T10:00:00.000Z");
  });

  it("MONTHLY clamps a month-end overflow (Jan 31 → Feb 28 in a non-leap year)", () => {
    expect(computePeriodEnd(new Date("2027-01-31T00:00:00Z"), "MONTHLY").toISOString()).toBe("2027-02-28T00:00:00.000Z");
  });

  it("MONTHLY clamps to Feb 29 in a leap year", () => {
    expect(computePeriodEnd(new Date("2028-01-31T00:00:00Z"), "MONTHLY").toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });

  it("ANNUAL adds exactly twelve calendar months", () => {
    expect(computePeriodEnd(new Date("2026-06-01T00:00:00Z"), "ANNUAL").toISOString()).toBe("2027-06-01T00:00:00.000Z");
  });

  it("ANNUAL normalizes Feb 29 → Feb 28 the next (non-leap) year", () => {
    expect(computePeriodEnd(new Date("2028-02-29T00:00:00Z"), "ANNUAL").toISOString()).toBe("2029-02-28T00:00:00.000Z");
  });
});

describe("computeConfirmedPeriod — early renewal loses no days, always one cycle", () => {
  const NOMINAL_MS_ONE_CYCLE = (start: Date, cycle: "MONTHLY" | "ANNUAL") => computePeriodEnd(start, cycle).getTime() - start.getTime();

  it("NEW_SUBSCRIPTION starts NOW (fresh cycle)", () => {
    const now = new Date("2026-09-20T12:00:00Z");
    const { periodStart, periodEnd } = computeConfirmedPeriod({ actionType: "NEW_SUBSCRIPTION", currentPeriodEnd: null, now, cycle: "MONTHLY" });
    expect(periodStart.toISOString()).toBe("2026-09-20T12:00:00.000Z");
    expect(periodEnd.toISOString()).toBe("2026-10-20T12:00:00.000Z");
  });

  it("ACTIVE MONTHLY early renewal extends from the current end (Sep 30 end, paid Sep 20 → Oct 30, NOT Oct 20)", () => {
    const { periodStart, periodEnd } = computeConfirmedPeriod({
      actionType: "RENEWAL",
      currentPeriodEnd: new Date("2026-09-30T00:00:00Z"),
      now: new Date("2026-09-20T00:00:00Z"),
      cycle: "MONTHLY",
    });
    expect(periodStart.toISOString()).toBe("2026-09-30T00:00:00.000Z"); // remaining days preserved
    expect(periodEnd.toISOString()).toBe("2026-10-30T00:00:00.000Z");
  });

  it("ACTIVE ANNUAL early renewal extends a full year from the current end (Dec 31 end, paid Nov 15 → Dec 31 next year)", () => {
    const { periodStart, periodEnd } = computeConfirmedPeriod({
      actionType: "RENEWAL",
      currentPeriodEnd: new Date("2026-12-31T00:00:00Z"),
      now: new Date("2026-11-15T00:00:00Z"),
      cycle: "ANNUAL",
    });
    expect(periodStart.toISOString()).toBe("2026-12-31T00:00:00.000Z");
    expect(periodEnd.toISOString()).toBe("2027-12-31T00:00:00.000Z");
  });

  it("repeated early renewals are deterministic — each adds exactly one cycle to the paid-through date, no reset, no giant period", () => {
    const cycle = "MONTHLY" as const;
    // Activate Sep 1 → Oct 1.
    let period = computeConfirmedPeriod({ actionType: "NEW_SUBSCRIPTION", currentPeriodEnd: null, now: new Date("2026-09-01T00:00:00Z"), cycle });
    expect(period.periodEnd.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    // Renew early Sep 20 → Nov 1.
    period = computeConfirmedPeriod({ actionType: "RENEWAL", currentPeriodEnd: period.periodEnd, now: new Date("2026-09-20T00:00:00Z"), cycle });
    expect(period.periodEnd.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    // Renew early Sep 25 → Dec 1.
    period = computeConfirmedPeriod({ actionType: "RENEWAL", currentPeriodEnd: period.periodEnd, now: new Date("2026-09-25T00:00:00Z"), cycle });
    expect(period.periodEnd.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    // The window is always exactly ONE nominal cycle (never a giant span).
    expect(period.periodEnd.getTime() - period.periodStart.getTime()).toBe(NOMINAL_MS_ONE_CYCLE(period.periodStart, cycle));
  });

  it("a lapsed ACTIVE (current end already past) renews from NOW, never backdated", () => {
    const now = new Date("2026-10-05T00:00:00Z");
    const { periodStart } = computeConfirmedPeriod({ actionType: "RENEWAL", currentPeriodEnd: new Date("2026-09-30T00:00:00Z"), now, cycle: "MONTHLY" });
    expect(periodStart.toISOString()).toBe(now.toISOString());
  });

  it("keeps future proration inputs well-defined: (period_end - period_start) is exactly one cycle; remaining may exceed it after stacking (credit for all prepaid time)", () => {
    const cycle = "MONTHLY" as const;
    const now = new Date("2026-09-25T00:00:00Z");
    // Two cycles prepaid ahead: current end already Dec 1.
    const { periodStart, periodEnd } = computeConfirmedPeriod({ actionType: "RENEWAL", currentPeriodEnd: new Date("2026-12-01T00:00:00Z"), now, cycle });
    const total = periodEnd.getTime() - periodStart.getTime();
    const remaining = periodEnd.getTime() - now.getTime();
    expect(total).toBe(NOMINAL_MS_ONE_CYCLE(periodStart, cycle)); // exactly one cycle — no ambiguity
    expect(remaining).toBeGreaterThan(total); // prepaid > 1 cycle → proration ratio >1, credit for ALL of it
  });
});

describe("generateHumanCode", () => {
  it("is RSD- prefixed, 5 body chars, from the unambiguous alphabet (no 0/1/O/I/L/U)", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateHumanCode();
      expect(code).toMatch(/^RSD-[0-9A-Z]{5}$/);
      const body = code.slice(4);
      for (const ch of body) expect(HUMAN_CODE_ALPHABET).toContain(ch);
      expect(body).not.toMatch(/[01OILU]/);
    }
  });

  it("is effectively unique across many draws (collision-retry backstops the rest)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) seen.add(generateHumanCode());
    expect(seen.size).toBeGreaterThan(490); // ~30^5 space → collisions vanishingly rare
  });
});

describe("payment request errors — typed, business-safe (mapped to 4xx, never 500)", () => {
  it("carry a stable code + httpStatus + the billing-domain marker", () => {
    const stale = new PaymentRequestStaleError();
    expect(stale.isBillingDomainError).toBe(true);
    expect(stale.code).toBe("PAYMENT_REQUEST_STALE");
    expect(stale.httpStatus).toBe(409);
    expect(new PaymentRequestNotPendingError().code).toBe("PAYMENT_REQUEST_NOT_PENDING");
    expect(new PaymentRequestExpiredError().httpStatus).toBe(409);
    expect(new PlanChangeNotSupportedError().code).toBe("PLAN_CHANGE_NOT_SUPPORTED");
  });
});

// Regression: a KEEP_CURRENT custom renewal used to stamp plan_price_version =
// NULL on the renewed CUSTOM period (offerVersion was null with no scheduled
// offer). It must carry the subscription's governing offer version forward.
describe("customRenewalPlanPriceVersion — CUSTOM renewal offer version (Phase 5 fix)", () => {
  it("KEEP_CURRENT (no scheduled offer) carries the subscription's offer version forward — never NULL", () => {
    expect(customRenewalPlanPriceVersion(null, 1)).toBe(1);
    expect(customRenewalPlanPriceVersion(null, 3)).toBe(3);
  });

  it("a scheduled NEXT_RENEWAL offer supplies its own version (wins over the subscription's)", () => {
    expect(customRenewalPlanPriceVersion(2, 1)).toBe(2);
  });

  it("passes NULL through only when the subscription itself has none (e.g. a TRIAL row, not a live CUSTOM)", () => {
    expect(customRenewalPlanPriceVersion(null, null)).toBeNull();
  });
});
