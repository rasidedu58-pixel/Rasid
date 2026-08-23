/**
 * Paddle webhook event → Subscription state mapping — Phase 8. Pure (no
 * DB access), so it is independently unit-testable against fixed payload
 * fixtures.
 *
 * Implements EXACTLY the corrected, explicit mapping (no invention beyond
 * it — every Paddle event type/shape not listed below is a documented
 * no-op, never a guess):
 *
 *   subscription.activated                                            → ACTIVE
 *   subscription.updated, scheduled_change.action=cancel, status=active → CANCELLED_AT_PERIOD_END
 *   subscription.updated, status=active, no scheduled_change            → ACTIVE
 *   subscription.past_due                                              → PAYMENT_FAILED
 *   subscription.canceled                                              → EXPIRED
 *
 * `transaction.completed` and `transaction.payment_failed` are NEVER
 * authoritative for subscription state on their own (explicit correction)
 * — they map to `null` (no state transition) here, exactly like any other
 * unrecognized event type. Subscription-level events are the only source
 * of truth for the state machine.
 */
import type { SubscriptionState } from "./entitlement-matrix";

export interface PaddleWebhookEnvelope {
  event_id: string;
  event_type: string;
  data: {
    id?: string; // provider_subscription_id for subscription.* events
    customer_id?: string;
    status?: string;
    scheduled_change?: { action?: string } | null;
    current_billing_period?: { starts_at?: string; ends_at?: string } | null;
    /** Paddle's checkout "custom_data" passthrough — set by /billing/checkout to `{ workspaceId }` so the webhook can resolve the workspace directly from the payload, without a prior DB lookup (see billing.repository.ts). */
    custom_data?: Record<string, unknown> | null;
  };
}

export interface MappedSubscriptionTransition {
  nextState: SubscriptionState;
  providerSubscriptionId: string | undefined;
  providerCustomerId: string | undefined;
  periodStart: Date | undefined;
  periodEnd: Date | undefined;
  /** true only for the CANCELLED_AT_PERIOD_END transition — every other mapped transition clears it. */
  cancelAtPeriodEnd: boolean;
}

function parseBillingPeriod(data: PaddleWebhookEnvelope["data"]): { periodStart: Date | undefined; periodEnd: Date | undefined } {
  const startsAt = data.current_billing_period?.starts_at;
  const endsAt = data.current_billing_period?.ends_at;
  return {
    periodStart: startsAt ? new Date(startsAt) : undefined,
    periodEnd: endsAt ? new Date(endsAt) : undefined,
  };
}

/** Returns `null` when the event is not one of the 5 explicitly-mapped subscription-level transitions — the caller must treat that as a safe no-op (still deduped/acknowledged, never a state change). */
export function mapPaddleEventToSubscriptionTransition(event: PaddleWebhookEnvelope): MappedSubscriptionTransition | null {
  const { periodStart, periodEnd } = parseBillingPeriod(event.data);
  const base = {
    providerSubscriptionId: event.data.id,
    providerCustomerId: event.data.customer_id,
    periodStart,
    periodEnd,
  };

  switch (event.event_type) {
    case "subscription.activated":
      return { ...base, nextState: "ACTIVE", cancelAtPeriodEnd: false };

    case "subscription.updated": {
      const hasCancelSchedule = event.data.scheduled_change?.action === "cancel";
      if (hasCancelSchedule && event.data.status === "active") {
        return { ...base, nextState: "CANCELLED_AT_PERIOD_END", cancelAtPeriodEnd: true };
      }
      if (!hasCancelSchedule && event.data.status === "active") {
        return { ...base, nextState: "ACTIVE", cancelAtPeriodEnd: false };
      }
      // Any other status/scheduled_change combination on `updated` (e.g.
      // paused) is not one of the 5 explicitly-approved transitions —
      // never guessed.
      return null;
    }

    case "subscription.past_due":
      return { ...base, nextState: "PAYMENT_FAILED", cancelAtPeriodEnd: false };

    case "subscription.canceled":
      return { ...base, nextState: "EXPIRED", cancelAtPeriodEnd: false };

    default:
      // Includes transaction.completed / transaction.payment_failed
      // (explicitly not authoritative on their own) and every other
      // Paddle event type — safe no-op.
      return null;
  }
}
