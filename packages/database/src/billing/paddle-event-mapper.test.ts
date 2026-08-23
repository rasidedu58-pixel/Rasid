import { describe, expect, it } from "vitest";
import { mapPaddleEventToSubscriptionTransition, type PaddleWebhookEnvelope } from "./paddle-event-mapper";

function event(partial: Partial<PaddleWebhookEnvelope> & { event_type: string }): PaddleWebhookEnvelope {
  return {
    event_id: "evt_1",
    data: { id: "sub_1", customer_id: "ctm_1" },
    ...partial,
  };
}

describe("mapPaddleEventToSubscriptionTransition", () => {
  it("subscription.activated → ACTIVE", () => {
    const result = mapPaddleEventToSubscriptionTransition(event({ event_type: "subscription.activated" }));
    expect(result?.nextState).toBe("ACTIVE");
    expect(result?.cancelAtPeriodEnd).toBe(false);
  });

  it("subscription.updated with scheduled_change.action=cancel while status=active → CANCELLED_AT_PERIOD_END", () => {
    const result = mapPaddleEventToSubscriptionTransition(
      event({ event_type: "subscription.updated", data: { id: "sub_1", status: "active", scheduled_change: { action: "cancel" } } }),
    );
    expect(result?.nextState).toBe("CANCELLED_AT_PERIOD_END");
    expect(result?.cancelAtPeriodEnd).toBe(true);
  });

  it("subscription.updated back to active with no scheduled_change → ACTIVE (resume/un-cancel)", () => {
    const result = mapPaddleEventToSubscriptionTransition(
      event({ event_type: "subscription.updated", data: { id: "sub_1", status: "active", scheduled_change: null } }),
    );
    expect(result?.nextState).toBe("ACTIVE");
    expect(result?.cancelAtPeriodEnd).toBe(false);
  });

  it("subscription.updated with status=paused (or any other combination) is a safe no-op — never guessed", () => {
    const result = mapPaddleEventToSubscriptionTransition(
      event({ event_type: "subscription.updated", data: { id: "sub_1", status: "paused" } }),
    );
    expect(result).toBeNull();
  });

  it("subscription.past_due → PAYMENT_FAILED", () => {
    const result = mapPaddleEventToSubscriptionTransition(event({ event_type: "subscription.past_due" }));
    expect(result?.nextState).toBe("PAYMENT_FAILED");
  });

  it("subscription.canceled → EXPIRED", () => {
    const result = mapPaddleEventToSubscriptionTransition(event({ event_type: "subscription.canceled" }));
    expect(result?.nextState).toBe("EXPIRED");
  });

  it("transaction.completed is NEVER authoritative on its own — no-op, never grants ACTIVE", () => {
    const result = mapPaddleEventToSubscriptionTransition(event({ event_type: "transaction.completed" }));
    expect(result).toBeNull();
  });

  it("transaction.payment_failed is NEVER authoritative on its own — no-op, never sets PAYMENT_FAILED", () => {
    const result = mapPaddleEventToSubscriptionTransition(event({ event_type: "transaction.payment_failed" }));
    expect(result).toBeNull();
  });

  it("an unrecognized event type is a safe no-op", () => {
    const result = mapPaddleEventToSubscriptionTransition(event({ event_type: "customer.created" }));
    expect(result).toBeNull();
  });

  it("extracts current_billing_period into periodStart/periodEnd when present", () => {
    const result = mapPaddleEventToSubscriptionTransition(
      event({
        event_type: "subscription.activated",
        data: { id: "sub_1", current_billing_period: { starts_at: "2026-08-01T00:00:00Z", ends_at: "2026-09-01T00:00:00Z" } },
      }),
    );
    expect(result?.periodStart?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(result?.periodEnd?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });
});
