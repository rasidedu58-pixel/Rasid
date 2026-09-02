import { describe, expect, it } from "vitest";
import {
  deriveDisplaySubscriptionStatus,
  paymentRequestIsExpired,
  effectivePaymentRequestStatus,
  customOfferIsExpired,
  resolveBillingPrimaryAction,
  capacityCtaTargetFor,
  compareBillingAttentionItems,
  computeLaunchReady,
  SUBSCRIPTION_STATUS_COPY,
  type BillingPrimaryActionInput,
  type BillingAttentionItem,
} from "./billing-lifecycle";

const baseAction = (over: Partial<BillingPrimaryActionInput> = {}): BillingPrimaryActionInput => ({
  state: "ACTIVE",
  hasPendingPaymentRequest: false,
  hasFailedOrExpiredPaymentRequest: false,
  hasAcceptedCustomOfferAwaitingPayment: false,
  hasPendingCustomOffer: false,
  hasScheduledDowngrade: false,
  capacityBand: null,
  tier: "STANDARD",
  hasFuturePaidPeriod: false,
  daysUntilPeriodEnd: 20,
  ...over,
});

describe("subscription status copy — never a raw enum, display-only EXPIRING", () => {
  it("has Arabic copy for every persisted state", () => {
    expect(SUBSCRIPTION_STATUS_COPY.TRIAL.label).toBe("الفترة التجريبية");
    expect(SUBSCRIPTION_STATUS_COPY.ACTIVE.label).toBe("نشط");
    expect(SUBSCRIPTION_STATUS_COPY.EXPIRED.label).toBe("منتهي");
    expect(SUBSCRIPTION_STATUS_COPY.PAYMENT_FAILED.label).toBe("تعذّر تأكيد الدفع");
    expect(SUBSCRIPTION_STATUS_COPY.CANCELLED_AT_PERIOD_END.label).toBe("سينتهي في نهاية الفترة");
  });

  it("shows an ACTIVE sub within 7 days (not prepaid) as EXPIRING — display only", () => {
    expect(deriveDisplaySubscriptionStatus({ state: "ACTIVE", daysUntilPeriodEnd: 3, hasFuturePaidPeriod: false })).toBe("EXPIRING");
  });
  it("keeps ACTIVE when a future paid period covers it (prepaid renewal → no false EXPIRING)", () => {
    expect(deriveDisplaySubscriptionStatus({ state: "ACTIVE", daysUntilPeriodEnd: 2, hasFuturePaidPeriod: true })).toBe("ACTIVE");
  });
  it("keeps ACTIVE when far from period_end", () => {
    expect(deriveDisplaySubscriptionStatus({ state: "ACTIVE", daysUntilPeriodEnd: 20, hasFuturePaidPeriod: false })).toBe("ACTIVE");
  });
  it("never invents EXPIRING for a TRIAL", () => {
    expect(deriveDisplaySubscriptionStatus({ state: "TRIAL", daysUntilPeriodEnd: 1, hasFuturePaidPeriod: false })).toBe("TRIAL");
  });
});

describe("deterministic expiry derivation", () => {
  it("PENDING past expires_at is derived EXPIRED (even before the worker flip)", () => {
    expect(paymentRequestIsExpired({ status: "PENDING", expiresAtMs: 100, nowMs: 200 })).toBe(true);
    expect(effectivePaymentRequestStatus({ status: "PENDING", expiresAtMs: 100, nowMs: 200 })).toBe("EXPIRED");
  });
  it("PENDING before expiry is still PENDING; a CONFIRMED request is never re-derived", () => {
    expect(paymentRequestIsExpired({ status: "PENDING", expiresAtMs: 300, nowMs: 200 })).toBe(false);
    expect(effectivePaymentRequestStatus({ status: "CONFIRMED", expiresAtMs: 100, nowMs: 200 })).toBe("CONFIRMED");
  });
  it("a PENDING_CUSTOMER offer past valid_until is derived expired", () => {
    expect(customOfferIsExpired({ status: "PENDING_CUSTOMER", validUntilMs: 100, nowMs: 200 })).toBe(true);
    expect(customOfferIsExpired({ status: "ACCEPTED", validUntilMs: 100, nowMs: 200 })).toBe(false);
  });

  // Expiry INVARIANTS (the worker flips exactly these transitions; the derivation
  // mirrors the same rule, so a non-flippable status is NEVER treated as expired).
  it("payment invariant — ONLY PENDING can become EXPIRED; CONFIRMED/REJECTED/CANCELLED/EXPIRED never", () => {
    for (const status of ["CONFIRMED", "REJECTED", "CANCELLED", "EXPIRED"]) {
      expect(paymentRequestIsExpired({ status, expiresAtMs: 1, nowMs: 999 })).toBe(false);
      expect(effectivePaymentRequestStatus({ status, expiresAtMs: 1, nowMs: 999 })).toBe(status);
    }
    expect(paymentRequestIsExpired({ status: "PENDING", expiresAtMs: 1, nowMs: 999 })).toBe(true);
  });
  it("offer invariant — ONLY PENDING_CUSTOMER can become EXPIRED; ACCEPTED/APPLIED/REJECTED/SUPERSEDED never", () => {
    for (const status of ["ACCEPTED", "APPLIED", "REJECTED", "SUPERSEDED", "CANCELLED", "EXPIRED"]) {
      expect(customOfferIsExpired({ status, validUntilMs: 1, nowMs: 999 })).toBe(false);
    }
    expect(customOfferIsExpired({ status: "PENDING_CUSTOMER", validUntilMs: 1, nowMs: 999 })).toBe(true);
  });
});

describe("resolveBillingPrimaryAction — one deterministic CTA, access-urgency first", () => {
  it("a pending payment beats everything (upgrade/capacity/offer)", () => {
    expect(resolveBillingPrimaryAction(baseAction({ hasPendingPaymentRequest: true, capacityBand: 100, hasPendingCustomOffer: true })).action).toBe("CONTINUE_PAYMENT");
  });
  it("an accepted custom offer awaiting payment beats a blocked state", () => {
    expect(resolveBillingPrimaryAction(baseAction({ state: "EXPIRED", hasAcceptedCustomOfferAwaitingPayment: true })).action).toBe("PAY_CUSTOM_OFFER");
  });
  it("EXPIRED / PAYMENT_FAILED with nothing pending → RENEW", () => {
    expect(resolveBillingPrimaryAction(baseAction({ state: "EXPIRED" })).action).toBe("RENEW");
    expect(resolveBillingPrimaryAction(baseAction({ state: "PAYMENT_FAILED" })).action).toBe("RENEW");
  });
  it("a pending offer to accept beats a stale rejected payment", () => {
    expect(resolveBillingPrimaryAction(baseAction({ hasPendingCustomOffer: true, hasFailedOrExpiredPaymentRequest: true })).action).toBe("REVIEW_CUSTOM_OFFER");
  });
  it("100% capacity → AT_CAPACITY with the tier-correct target", () => {
    expect(resolveBillingPrimaryAction(baseAction({ capacityBand: 100, tier: "STANDARD" }))).toEqual({ action: "AT_CAPACITY", capacityTarget: "UPGRADE" });
    expect(resolveBillingPrimaryAction(baseAction({ capacityBand: 100, tier: "BUSINESS_PLUS" }))).toEqual({ action: "AT_CAPACITY", capacityTarget: "REQUEST_CUSTOM" });
    expect(resolveBillingPrimaryAction(baseAction({ capacityBand: 100, tier: "CUSTOM" }))).toEqual({ action: "AT_CAPACITY", capacityTarget: "MODIFY_CUSTOM" });
  });
  it("renewal window (no prepaid) → RENEW_SOON, but NOT when a future paid period exists", () => {
    expect(resolveBillingPrimaryAction(baseAction({ daysUntilPeriodEnd: 5 })).action).toBe("RENEW_SOON");
    expect(resolveBillingPrimaryAction(baseAction({ daysUntilPeriodEnd: 5, hasFuturePaidPeriod: true })).action).toBe("NONE");
  });
  it("90/95% → NEAR_CAPACITY; scheduled downgrade is lowest priority; else NONE", () => {
    expect(resolveBillingPrimaryAction(baseAction({ capacityBand: 90 })).action).toBe("NEAR_CAPACITY");
    expect(resolveBillingPrimaryAction(baseAction({ hasScheduledDowngrade: true })).action).toBe("REVIEW_SCHEDULED_DOWNGRADE");
    expect(resolveBillingPrimaryAction(baseAction()).action).toBe("NONE");
  });
  it("capacityCtaTargetFor maps tiers", () => {
    expect(capacityCtaTargetFor("STANDARD")).toBe("UPGRADE");
    expect(capacityCtaTargetFor("BUSINESS_PLUS")).toBe("REQUEST_CUSTOM");
    expect(capacityCtaTargetFor("CUSTOM")).toBe("MODIFY_CUSTOM");
  });
});

describe("attention ordering + launch readiness", () => {
  const item = (over: Partial<BillingAttentionItem>): BillingAttentionItem => ({
    kind: "CUSTOM_REQUEST_PENDING",
    severity: "MEDIUM",
    workspaceId: "00000000-0000-0000-0000-000000000000",
    workspaceName: null,
    title: "x",
    since: "2026-01-01T00:00:00.000Z",
    target: "custom-plans",
    entityId: null,
    ...over,
  });
  it("orders by severity then oldest-first", () => {
    const high = item({ severity: "HIGH", since: "2026-02-01T00:00:00.000Z" });
    const medOld = item({ severity: "MEDIUM", since: "2026-01-01T00:00:00.000Z" });
    const medNew = item({ severity: "MEDIUM", since: "2026-03-01T00:00:00.000Z" });
    const sorted = [medNew, medOld, high].sort(compareBillingAttentionItems);
    expect(sorted.map((i) => i.since)).toEqual(["2026-02-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z"]);
  });
  it("launch is ready only when every check passes", () => {
    expect(computeLaunchReady([{ check: "MIGRATIONS_CURRENT", ok: true, detail: "" }, { check: "WORKER_HEALTHY", ok: true, detail: "" }])).toBe(true);
    expect(computeLaunchReady([{ check: "MIGRATIONS_CURRENT", ok: true, detail: "" }, { check: "PAYMENT_CHANNELS_CONFIGURED", ok: false, detail: "" }])).toBe(false);
    expect(computeLaunchReady([])).toBe(false);
  });
});
