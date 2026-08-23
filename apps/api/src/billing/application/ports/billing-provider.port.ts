/**
 * Billing provider abstraction — Phase 8, ADR-014 ("Paddle كبداية خلف
 * BillingProvider adapter؛ webhook/backend confirmation هو Source of
 * Truth؛ redirect وحده لا يمنح Entitlement"). `PaddleBillingProvider` is
 * the real implementation; `FakeBillingProvider` (tests) never calls a
 * real network endpoint. Every implementation is checkout/portal
 * CREATION only — it must never itself grant access; only the webhook
 * processor (`BillingService.handlePaddleWebhook`, driven by
 * `updateSubscriptionStateTransaction`) is allowed to change Subscription/
 * Entitlement state.
 */
export interface CreateCheckoutSessionInput {
  workspaceId: string;
  /** Verified owner email, if known — pre-fills the provider's checkout form; never required. */
  customerEmail: string | null;
  /** Where the provider should send the browser back to after checkout (success OR cancel) — this redirect itself grants nothing (see module doc comment). */
  returnUrl: string;
}

export interface CreateCheckoutSessionResult {
  checkoutUrl: string;
}

export interface CreatePortalSessionInput {
  providerCustomerId: string;
  returnUrl: string;
}

export interface CreatePortalSessionResult {
  portalUrl: string;
}

export interface BillingProviderPort {
  createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CreateCheckoutSessionResult>;
  createPortalSession(input: CreatePortalSessionInput): Promise<CreatePortalSessionResult>;
}

export const BILLING_PROVIDER = Symbol("BILLING_PROVIDER");
