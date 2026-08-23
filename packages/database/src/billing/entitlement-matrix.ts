/**
 * Entitlement resolution — Phase 8. Pure, deterministic (no DB access),
 * mirroring `attention/rule-engine.ts`'s/`scheduling/proration.ts`'s
 * convention so this is independently unit-testable.
 *
 * Derived literally from PRD §44.2.1 "Final Entitlement Matrix" — V1 keeps
 * exactly the 4 capability keys the approved docs name explicitly
 * (Database Schema §10.2): CORE_OPERATIONS, CREATE_MONTH, TEAM_MANAGEMENT,
 * REPORT_EXPORT. No HISTORICAL_READ/BILLING_ACCESS keys (explicit
 * correction) — historical reads and the `/billing/*` endpoints are gated
 * by ordinary Permission/Scope only, never by Entitlement, and therefore
 * never appear in this matrix at all.
 */

export const CAPABILITIES = ["CORE_OPERATIONS", "CREATE_MONTH", "TEAM_MANAGEMENT", "REPORT_EXPORT"] as const;
export type Capability = (typeof CAPABILITIES)[number];

export type EntitlementState = "ALLOWED" | "BLOCKED";

export const SUBSCRIPTION_STATES = [
  "TRIAL",
  "ACTIVE",
  "EXPIRING",
  "EXPIRED",
  "PAYMENT_FAILED",
  "CANCELLED_AT_PERIOD_END",
] as const;
export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];

/**
 * PRD §44.2.1's matrix, collapsed to exactly two rows since all 4 V1
 * capabilities move together (the approved matrix never differentiates
 * CORE_OPERATIONS from CREATE_MONTH/TEAM_MANAGEMENT/REPORT_EXPORT by
 * subscription state — every row's "Block" column blocks all four
 * identically). TRIAL/ACTIVE/EXPIRING/CANCELLED_AT_PERIOD_END = full
 * operations ("Cancelled at period end" is explicitly "Allow until end" —
 * treated as fully active until `period_end`, per §44.2's own rule and the
 * user's stated policy). EXPIRED/PAYMENT_FAILED = every V1 capability
 * blocked; reads/billing remain reachable but through Permission/Scope
 * alone, never through this matrix.
 */
const BLOCKED_STATES: ReadonlySet<SubscriptionState> = new Set(["EXPIRED", "PAYMENT_FAILED"]);

export function resolveEntitlementState(subscriptionState: SubscriptionState): EntitlementState {
  return BLOCKED_STATES.has(subscriptionState) ? "BLOCKED" : "ALLOWED";
}

/** The full 4-capability snapshot for a given Subscription state — what gets written to `entitlements` on every state transition. */
export function resolveEntitlementSnapshot(subscriptionState: SubscriptionState): Record<Capability, EntitlementState> {
  const state = resolveEntitlementState(subscriptionState);
  return {
    CORE_OPERATIONS: state,
    CREATE_MONTH: state,
    TEAM_MANAGEMENT: state,
    REPORT_EXPORT: state,
  };
}
