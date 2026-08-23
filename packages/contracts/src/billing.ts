import { z } from "zod";

/**
 * Billing / Entitlements contract types — Phase 8, API Contract v1.0
 * §9.9, §11.16. Shared between apps/api (producer) and apps/web
 * (consumer). No request/response JSON schema is given verbatim in the
 * approved API Contract for `/billing/checkout`/`/billing/portal`/
 * `/billing/subscription` (unlike e.g. §11.3's Create Month Preview) —
 * these shapes are this phase's own reasonable design (field
 * names/semantics all derive directly from `subscriptions`'s own approved
 * columns and ADR-014's adapter principle, not invented business rules).
 */

export const subscriptionStateSchema = z.enum([
  "TRIAL",
  "ACTIVE",
  "EXPIRING",
  "EXPIRED",
  "PAYMENT_FAILED",
  "CANCELLED_AT_PERIOD_END",
]);
export type SubscriptionStateDto = z.infer<typeof subscriptionStateSchema>;

export const subscriptionSchema = z.object({
  id: z.string().uuid(),
  provider: z.string(),
  state: subscriptionStateSchema,
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  version: z.number().int(),
});
export type Subscription = z.infer<typeof subscriptionSchema>;

export const getSubscriptionResponseSchema = z.object({ subscription: subscriptionSchema });
export type GetSubscriptionResponse = z.infer<typeof getSubscriptionResponseSchema>;

export const createCheckoutRequestSchema = z.object({
  /** Where Paddle sends the browser back to after checkout (success OR cancel) — this redirect itself grants no access (§11.16). */
  returnUrl: z.string().url(),
});
export type CreateCheckoutRequest = z.infer<typeof createCheckoutRequestSchema>;

export const createCheckoutResponseSchema = z.object({ checkoutUrl: z.string().url() });
export type CreateCheckoutResponse = z.infer<typeof createCheckoutResponseSchema>;

export const createPortalRequestSchema = z.object({ returnUrl: z.string().url() });
export type CreatePortalRequest = z.infer<typeof createPortalRequestSchema>;

export const createPortalResponseSchema = z.object({ portalUrl: z.string().url() });
export type CreatePortalResponse = z.infer<typeof createPortalResponseSchema>;

// ---------------------------------------------------------------------------
// Entitlements — GET /entitlements (§9.9: "Active membership | — |
// Effective workspace capabilities")
// ---------------------------------------------------------------------------

export const capabilitySchema = z.enum(["CORE_OPERATIONS", "CREATE_MONTH", "TEAM_MANAGEMENT", "REPORT_EXPORT"]);
export type CapabilityDto = z.infer<typeof capabilitySchema>;

export const entitlementStateSchema = z.enum(["ALLOWED", "BLOCKED"]);
export type EntitlementStateDto = z.infer<typeof entitlementStateSchema>;

export const entitlementSchema = z.object({
  capability: capabilitySchema,
  state: entitlementStateSchema,
});
export type EntitlementDto = z.infer<typeof entitlementSchema>;

export const listEntitlementsResponseSchema = z.object({ entitlements: z.array(entitlementSchema) });
export type ListEntitlementsResponse = z.infer<typeof listEntitlementsResponseSchema>;
