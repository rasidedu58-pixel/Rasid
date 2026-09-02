import { z } from "zod";
import { BILLING_CYCLES, STANDARD_PLAN_CODES, type BillingCycle, type StandardPlanCode } from "./billing-catalog";
import { subscriptionStateSchema } from "./billing";

/**
 * Payment Requests + manual payment verification — Billing Engine, Phase 3.
 * Shared api↔web. The manual V1 channel is InstaPay / Vodafone Cash with a
 * WhatsApp payment-proof deeplink; no screenshot ever enters Rasid (no upload,
 * no storage, no DB blob) — the image stays inside WhatsApp, correlated only by
 * the human-readable RSD code.
 */

/** UPGRADE is enumerated for forward-compat but NO upgrade flow exists in Phase 3. */
export const PAYMENT_REQUEST_ACTION_TYPES = ["NEW_SUBSCRIPTION", "RENEWAL", "UPGRADE"] as const;
export type PaymentRequestActionType = (typeof PAYMENT_REQUEST_ACTION_TYPES)[number];

export const BILLING_PAYMENT_METHODS = ["INSTAPAY", "VODAFONE_CASH"] as const;
export const billingPaymentMethodSchema = z.enum(BILLING_PAYMENT_METHODS);
export type BillingPaymentMethod = (typeof BILLING_PAYMENT_METHODS)[number];

export const PAYMENT_REQUEST_STATUSES = ["PENDING", "CONFIRMED", "REJECTED", "CANCELLED", "EXPIRED"] as const;
export const paymentRequestStatusSchema = z.enum(PAYMENT_REQUEST_STATUSES);
export type PaymentRequestStatus = (typeof PAYMENT_REQUEST_STATUSES)[number];

const standardPlanCodeSchema = z.enum(STANDARD_PLAN_CODES as unknown as [StandardPlanCode, ...StandardPlanCode[]]);
const billingCycleSchema = z.enum(BILLING_CYCLES as unknown as [BillingCycle, ...BillingCycle[]]);

// ---------------------------------------------------------------------------
// Customer: create a payment request. Price is SERVER-computed from the plan
// catalog — the client sends ONLY the selection, never a trusted amount.
// ---------------------------------------------------------------------------

export const createPaymentRequestSchema = z.object({
  planCode: standardPlanCodeSchema,
  billingCycle: billingCycleSchema,
  paymentMethod: billingPaymentMethodSchema,
});
export type CreatePaymentRequest = z.infer<typeof createPaymentRequestSchema>;

/** The customer-facing view of a payment request (no internal actor ids / quote internals). */
export const paymentRequestSchema = z.object({
  id: z.string().uuid(),
  humanCode: z.string(),
  actionType: z.enum(PAYMENT_REQUEST_ACTION_TYPES),
  targetPlanCode: z.string(),
  billingCycle: billingCycleSchema,
  amountMinor: z.number().int(),
  currencyCode: z.string(),
  paymentMethod: billingPaymentMethodSchema,
  status: paymentRequestStatusSchema,
  rejectReason: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
});
export type PaymentRequestDto = z.infer<typeof paymentRequestSchema>;

/** Payment instructions + WhatsApp proof deeplink returned alongside a created/pending request. */
export const paymentInstructionsSchema = z.object({
  method: billingPaymentMethodSchema,
  /** The handle/number to pay TO — null when that channel is not configured (business-safe unavailable state). */
  payToHandle: z.string().nullable(),
  amountMinor: z.number().int(),
  currencyCode: z.string(),
  humanCode: z.string(),
  whatsapp: z.object({
    available: z.boolean(),
    /** wa.me deeplink with a prefilled message embedding plan/cycle/amount/code — null when the billing WhatsApp number is unconfigured. */
    deeplink: z.string().nullable(),
  }),
});
export type PaymentInstructions = z.infer<typeof paymentInstructionsSchema>;

export const createPaymentRequestResponseSchema = z.object({
  paymentRequest: paymentRequestSchema,
  instructions: paymentInstructionsSchema,
});
export type CreatePaymentRequestResponse = z.infer<typeof createPaymentRequestResponseSchema>;

export const listPaymentRequestsResponseSchema = z.object({
  paymentRequests: z.array(paymentRequestSchema),
});
export type ListPaymentRequestsResponse = z.infer<typeof listPaymentRequestsResponseSchema>;

// ---------------------------------------------------------------------------
// Platform admin: list + confirm / reject.
// ---------------------------------------------------------------------------

export const platformPaymentRequestSchema = paymentRequestSchema.extend({
  workspaceId: z.string().uuid(),
  workspaceName: z.string().nullable(),
  customerName: z.string().nullable(),
  customerPhone: z.string().nullable(),
  /** For an UPGRADE row: the plan being upgraded FROM (from the immutable quote snapshot). */
  currentPlanCode: z.string().nullable(),
  /** For a CUSTOM row (target CUSTOM): the accepted offer version + agreed capacities (from the immutable snapshot). */
  offerVersion: z.number().int().nullable(),
  customMaxActiveStudents: z.number().int().nullable(),
  customMaxTeamMembers: z.number().int().nullable(),
});
export type PlatformPaymentRequestDto = z.infer<typeof platformPaymentRequestSchema>;

export const listPlatformPaymentRequestsResponseSchema = z.object({
  items: z.array(platformPaymentRequestSchema),
  page: z.object({ nextCursor: z.string().nullable(), hasNext: z.boolean() }),
});
export type ListPlatformPaymentRequestsResponse = z.infer<typeof listPlatformPaymentRequestsResponseSchema>;

/** Confirm carries an Idempotency-Key header (not a body field); body is empty. */
export const confirmPaymentRequestSchema = z.object({}).strict();
export type ConfirmPaymentRequest = z.infer<typeof confirmPaymentRequestSchema>;

export const rejectPaymentRequestSchema = z.object({
  reason: z.string().min(1, "سبب الرفض مطلوب").max(500),
});
export type RejectPaymentRequest = z.infer<typeof rejectPaymentRequestSchema>;

export const resolvePaymentRequestResponseSchema = z.object({
  paymentRequest: platformPaymentRequestSchema,
});
export type ResolvePaymentRequestResponse = z.infer<typeof resolvePaymentRequestResponseSchema>;

// ---------------------------------------------------------------------------
// Phase 4 — plan changes (upgrade / downgrade) + billing plan state.
// ---------------------------------------------------------------------------

/** Current commercial state the customer billing page needs (owner-only). */
export const billingPlanStateSchema = z.object({
  state: subscriptionStateSchema,
  currentPlanCode: z.string().nullable(),
  billingCycle: billingCycleSchema.nullable(),
  periodEnd: z.string().nullable(),
  limits: z.object({ maxActiveStudents: z.number().int(), maxTeamMembers: z.number().int() }),
  usage: z.object({ activeStudents: z.number().int(), activeTeamMembers: z.number().int() }),
  /** A scheduled downgrade that becomes effective at the next renewal, or null. */
  pendingDowngrade: z.object({ targetPlanCode: z.string(), billingCycle: billingCycleSchema }).nullable(),
});
export type BillingPlanStateDto = z.infer<typeof billingPlanStateSchema>;

export const getBillingPlanStateResponseSchema = z.object({ planState: billingPlanStateSchema });
export type GetBillingPlanStateResponse = z.infer<typeof getBillingPlanStateResponseSchema>;

/** Read-only upgrade quote preview (server-priced; the client sends no amount). */
export const upgradeQuoteRequestSchema = z.object({
  targetPlanCode: standardPlanCodeSchema,
  billingCycle: billingCycleSchema,
});
export type UpgradeQuoteRequest = z.infer<typeof upgradeQuoteRequestSchema>;

export const upgradeQuoteResponseSchema = z.object({
  eligible: z.boolean(),
  /** Typed reason when not eligible (e.g. NOT_AN_UPGRADE, CROSS_CYCLE_UPGRADE_NOT_SUPPORTED, UPGRADE_PRORATION_NON_POSITIVE). */
  reason: z.string().nullable(),
  currentPlanCode: z.string().nullable(),
  targetPlanCode: standardPlanCodeSchema,
  billingCycle: billingCycleSchema,
  normalTargetPriceMinor: z.number().int(),
  creditRemainingMinor: z.number().int(),
  amountDueMinor: z.number().int(),
  currencyCode: z.string(),
  /** period_end stays the same after an upgrade. */
  paidThrough: z.string().nullable(),
});
export type UpgradeQuoteResponse = z.infer<typeof upgradeQuoteResponseSchema>;

/** Schedule a downgrade to a lower plan, effective at the next renewal (owner-only). */
export const scheduleDowngradeRequestSchema = z.object({ targetPlanCode: standardPlanCodeSchema });
export type ScheduleDowngradeRequest = z.infer<typeof scheduleDowngradeRequestSchema>;

export const scheduleDowngradeResponseSchema = z.object({
  pendingDowngrade: z.object({ targetPlanCode: z.string(), billingCycle: billingCycleSchema }).nullable(),
});
export type ScheduleDowngradeResponse = z.infer<typeof scheduleDowngradeResponseSchema>;
