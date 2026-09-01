import { z } from "zod";
import { BILLING_CYCLES, STANDARD_PLAN_CODES, type BillingCycle, type StandardPlanCode } from "./billing-catalog";

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
