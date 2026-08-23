import { describe, expect, it } from "vitest";
import { resolveEntitlementSnapshot, resolveEntitlementState, SUBSCRIPTION_STATES } from "./entitlement-matrix";

describe("resolveEntitlementState", () => {
  it("ALLOWED for TRIAL/ACTIVE/EXPIRING/CANCELLED_AT_PERIOD_END — full operations", () => {
    expect(resolveEntitlementState("TRIAL")).toBe("ALLOWED");
    expect(resolveEntitlementState("ACTIVE")).toBe("ALLOWED");
    expect(resolveEntitlementState("EXPIRING")).toBe("ALLOWED");
    expect(resolveEntitlementState("CANCELLED_AT_PERIOD_END")).toBe("ALLOWED");
  });

  it("BLOCKED for EXPIRED/PAYMENT_FAILED", () => {
    expect(resolveEntitlementState("EXPIRED")).toBe("BLOCKED");
    expect(resolveEntitlementState("PAYMENT_FAILED")).toBe("BLOCKED");
  });

  it("covers every declared SubscriptionState with no fallthrough gaps", () => {
    for (const state of SUBSCRIPTION_STATES) {
      expect(["ALLOWED", "BLOCKED"]).toContain(resolveEntitlementState(state));
    }
  });
});

describe("resolveEntitlementSnapshot", () => {
  it("all 4 V1 capabilities move together — none differ by subscription state", () => {
    const allowed = resolveEntitlementSnapshot("ACTIVE");
    expect(allowed).toEqual({
      CORE_OPERATIONS: "ALLOWED",
      CREATE_MONTH: "ALLOWED",
      TEAM_MANAGEMENT: "ALLOWED",
      REPORT_EXPORT: "ALLOWED",
    });

    const blocked = resolveEntitlementSnapshot("EXPIRED");
    expect(blocked).toEqual({
      CORE_OPERATIONS: "BLOCKED",
      CREATE_MONTH: "BLOCKED",
      TEAM_MANAGEMENT: "BLOCKED",
      REPORT_EXPORT: "BLOCKED",
    });
  });

  it("PAYMENT_FAILED blocks REPORT_EXPORT exactly like EXPIRED does (CSV export blocked)", () => {
    expect(resolveEntitlementSnapshot("PAYMENT_FAILED").REPORT_EXPORT).toBe("BLOCKED");
  });

  it("Cancelled-at-period-end does not stop service early — full operations, matching Active", () => {
    expect(resolveEntitlementSnapshot("CANCELLED_AT_PERIOD_END")).toEqual(resolveEntitlementSnapshot("ACTIVE"));
  });
});
