import { describe, expect, it } from "vitest";
import { createPaymentRequestSchema, rejectPaymentRequestSchema, BILLING_PAYMENT_METHODS } from "./billing-payment-requests";
import { hasPlatformPermission } from "./platform-operations";

describe("createPaymentRequest — price trust boundary", () => {
  it("accepts only the selection (planCode, billingCycle, paymentMethod)", () => {
    const parsed = createPaymentRequestSchema.parse({ planCode: "PROFESSIONAL", billingCycle: "MONTHLY", paymentMethod: "INSTAPAY" });
    expect(parsed).toEqual({ planCode: "PROFESSIONAL", billingCycle: "MONTHLY", paymentMethod: "INSTAPAY" });
  });

  it("NEVER accepts a client-supplied amount/price/limit — those fields are stripped, never trusted", () => {
    const parsed = createPaymentRequestSchema.parse({
      planCode: "STARTER",
      billingCycle: "ANNUAL",
      paymentMethod: "VODAFONE_CASH",
      amountMinor: 1,
      planPriceVersion: 999,
      maxActiveStudents: 999999,
    } as unknown);
    expect(parsed).not.toHaveProperty("amountMinor");
    expect(parsed).not.toHaveProperty("planPriceVersion");
    expect(parsed).not.toHaveProperty("maxActiveStudents");
  });

  it("rejects a non-standard plan (CUSTOM / TRIAL) and an unknown payment method", () => {
    expect(createPaymentRequestSchema.safeParse({ planCode: "CUSTOM", billingCycle: "MONTHLY", paymentMethod: "INSTAPAY" }).success).toBe(false);
    expect(createPaymentRequestSchema.safeParse({ planCode: "PROFESSIONAL", billingCycle: "MONTHLY", paymentMethod: "PAYPAL" }).success).toBe(false);
    expect(BILLING_PAYMENT_METHODS).toEqual(["INSTAPAY", "VODAFONE_CASH"]);
  });
});

describe("rejectPaymentRequest", () => {
  it("requires a non-empty reason", () => {
    expect(rejectPaymentRequestSchema.safeParse({ reason: "" }).success).toBe(false);
    expect(rejectPaymentRequestSchema.safeParse({ reason: "لم يصل التحويل" }).success).toBe(true);
  });
});

describe("platform billing RBAC — SUPPORT_AGENT can never confirm a payment", () => {
  it("SUPPORT_AGENT has neither platform.billing.view nor .manage", () => {
    expect(hasPlatformPermission("SUPPORT_AGENT", "platform.billing.view")).toBe(false);
    expect(hasPlatformPermission("SUPPORT_AGENT", "platform.billing.manage")).toBe(false);
  });

  it("OPERATIONS_ADMIN and PLATFORM_OWNER have both billing permissions", () => {
    for (const role of ["OPERATIONS_ADMIN", "PLATFORM_OWNER"] as const) {
      expect(hasPlatformPermission(role, "platform.billing.view")).toBe(true);
      expect(hasPlatformPermission(role, "platform.billing.manage")).toBe(true);
    }
  });
});
