import { z } from "zod";

/**
 * Finance contract types — Phase 6, API Contract v1.0 §9.6, §11.10-11.12.
 * Shared between apps/api (producer) and apps/web (consumer).
 *
 * No `/finance/collection-queue`/`/finance/summary` JSON schema example is
 * given anywhere in the approved API Contract §11 (confirmed by exhaustive
 * search) — their shapes below are this phase's own reasonable design
 * (documented, not invented business rules: field names/semantics all
 * derive directly from `financial_obligations`' own approved columns).
 */

// ---------------------------------------------------------------------------
// Obligation
// ---------------------------------------------------------------------------

export const obligationStatusSchema = z.enum(["UNPAID", "PARTIAL", "PAID"]);
export type ObligationStatus = z.infer<typeof obligationStatusSchema>;

export const obligationCalculationBasisSchema = z.enum(["FULL_MONTH", "CUSTOM", "REMAINING_SESSIONS"]);
export type ObligationCalculationBasis = z.infer<typeof obligationCalculationBasisSchema>;

export const obligationSchema = z.object({
  id: z.string().uuid(),
  enrollmentId: z.string().uuid(),
  currency: z.string(),
  baseFeeMinor: z.number().int(),
  discountMinor: z.number().int(),
  waiverMinor: z.number().int(),
  netDueMinor: z.number().int(),
  dueDate: z.string(),
  amountPaidMinor: z.number().int(),
  remainingMinor: z.number().int(),
  status: obligationStatusSchema,
  calculationBasis: obligationCalculationBasisSchema,
  version: z.number().int(),
});
export type Obligation = z.infer<typeof obligationSchema>;

// ---------------------------------------------------------------------------
// Payment
// ---------------------------------------------------------------------------

export const paymentMethodSchema = z.enum(["CASH", "TRANSFER", "WALLET", "OTHER"]);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const paymentStatusSchema = z.enum(["POSTED", "REVERSED"]);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const paymentSchema = z.object({
  id: z.string().uuid(),
  obligationId: z.string().uuid(),
  amountMinor: z.number().int(),
  currency: z.string(),
  method: paymentMethodSchema,
  paidAt: z.string(),
  status: paymentStatusSchema,
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type Payment = z.infer<typeof paymentSchema>;

// ---------------------------------------------------------------------------
// Record Payment — API §11.11. Idempotency-Key is a REQUIRED header, not a
// body field (API Contract §7 — same convention as Complete Session).
// ---------------------------------------------------------------------------

export const recordPaymentRequestSchema = z.object({
  obligationId: z.string().uuid(),
  amountMinor: z.number().int().positive(),
  method: paymentMethodSchema,
  paidAt: z.string().optional(),
  note: z.string().trim().min(1).optional(),
});
export type RecordPaymentRequest = z.infer<typeof recordPaymentRequestSchema>;

export const recordPaymentResponseSchema = z.object({
  payment: paymentSchema,
  obligation: obligationSchema,
});
export type RecordPaymentResponse = z.infer<typeof recordPaymentResponseSchema>;

// ---------------------------------------------------------------------------
// Reverse Payment — API §11.12 (verbatim example shape).
// ---------------------------------------------------------------------------

export const reversePaymentRequestSchema = z.object({
  reason: z.string().trim().min(1),
});
export type ReversePaymentRequest = z.infer<typeof reversePaymentRequestSchema>;

export const paymentReversalSchema = z.object({
  id: z.string().uuid(),
  reason: z.string(),
});
export type PaymentReversal = z.infer<typeof paymentReversalSchema>;

export const reversePaymentResponseSchema = z.object({
  payment: paymentSchema,
  reversal: paymentReversalSchema,
  obligation: obligationSchema,
});
export type ReversePaymentResponse = z.infer<typeof reversePaymentResponseSchema>;

// ---------------------------------------------------------------------------
// Student obligations — API §9.6 GET /students/{id}/obligations
// ---------------------------------------------------------------------------

export const studentObligationItemSchema = z.object({
  obligation: obligationSchema,
  groupMonthId: z.string().uuid(),
});
export type StudentObligationItem = z.infer<typeof studentObligationItemSchema>;

export const studentObligationsResponseSchema = z.object({
  obligations: z.array(studentObligationItemSchema),
});
export type StudentObligationsResponse = z.infer<typeof studentObligationsResponseSchema>;

// ---------------------------------------------------------------------------
// Collection Queue — API §9.6 GET /finance/collection-queue
// ---------------------------------------------------------------------------

export const collectionQueueItemSchema = z.object({
  obligationId: z.string().uuid(),
  studentId: z.string().uuid(),
  studentName: z.string(),
  studentCode: z.string(),
  groupMonthId: z.string().uuid(),
  dueDate: z.string(),
  netDueMinor: z.number().int(),
  amountPaidMinor: z.number().int(),
  remainingMinor: z.number().int(),
  status: obligationStatusSchema,
});
export type CollectionQueueItem = z.infer<typeof collectionQueueItemSchema>;

export const collectionQueueResponseSchema = z.object({
  items: z.array(collectionQueueItemSchema),
});
export type CollectionQueueResponse = z.infer<typeof collectionQueueResponseSchema>;

// ---------------------------------------------------------------------------
// Finance summary — API §9.6 GET /finance/summary
// ---------------------------------------------------------------------------

export const financeSummaryResponseSchema = z.object({
  currency: z.string(),
  totalNetDueMinor: z.number().int(),
  totalPaidMinor: z.number().int(),
  totalRemainingMinor: z.number().int(),
  unpaidCount: z.number().int(),
  partialCount: z.number().int(),
  paidCount: z.number().int(),
  overdueCount: z.number().int(),
  overdueRemainingMinor: z.number().int(),
});
export type FinanceSummaryResponse = z.infer<typeof financeSummaryResponseSchema>;
