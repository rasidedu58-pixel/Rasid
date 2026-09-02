import { z } from "zod";
import { BILLING_CURRENCY, BILLING_CYCLES, MAX_STANDARD_PLAN_STUDENTS, STANDARD_PLANS, type BillingCycle } from "./billing-catalog";
import { billingPaymentMethodSchema } from "./billing-payment-requests";

/**
 * Custom Plans — Billing Engine, Phase 5. PURE + deterministic, integer money
 * (ADR-022), no I/O. CUSTOM is a commercially NEGOTIATED agreement — it has NO
 * public catalog price. The helpers here produce an INTERNAL, admin-only
 * `SYSTEM_RECOMMENDED_PRICE` (never shown to the customer in V1, never a binding
 * quote); the final commercial price is a human-authorized offer.
 *
 * Eligibility: CUSTOM begins strictly ABOVE the largest standard plan —
 * `students > MAX_STANDARD_PLAN_STUDENTS` (3000). 3000 itself is BUSINESS_PLUS.
 */

/** Bump ONLY when the internal recommendation formula changes. Distinct from PLAN_PRICE_VERSION (catalog) and from a per-offer version. */
export const RECOMMENDATION_VERSION = 1;

/** Above BUSINESS_PLUS (3000 students @ 90000 minor/month), each +500 students band adds +10000 minor/month. */
const CUSTOM_BAND_STUDENTS = 500;
const CUSTOM_BAND_PRICE_MINOR = 10000; // +100 EGP per band
const BUSINESS_PLUS_MONTHLY_MINOR = STANDARD_PLANS.BUSINESS_PLUS.monthlyPriceMinor; // 90000
const BUSINESS_PLUS_STUDENTS = STANDARD_PLANS.BUSINESS_PLUS.maxActiveStudents; // 3000
const BUSINESS_PLUS_TEAM = STANDARD_PLANS.BUSINESS_PLUS.maxTeamMembers; // 15
const CUSTOM_TEAM_STUDENTS_PER_SEAT = 200; // ~1 non-owner seat per 200 students
const ANNUAL_MULTIPLIER = 10; // recommendation only ("pay 10 months") — a negotiated annual offer is independent

/** True when a requested active-student capacity can ONLY be served by CUSTOM (strictly > 3000). */
export function isCustomEligible(requestedMaxActiveStudents: number): boolean {
  return Number.isInteger(requestedMaxActiveStudents) && requestedMaxActiveStudents > MAX_STANDARD_PLAN_STUDENTS;
}

/** CTA threshold: surface "request a custom plan" once usage nears the top standard plan (>= 90% of 3000 = 2700). The request itself still requires > 3000. */
export function shouldSurfaceCustomCta(activeStudents: number): boolean {
  return activeStudents >= Math.ceil(BUSINESS_PLUS_STUDENTS * 0.9);
}

/** Internal recommended MONTHLY price (minor units) for a custom student capacity. Deterministic integer math. Throws below the CUSTOM floor. */
export function recommendCustomMonthlyMinor(students: number): number {
  if (!isCustomEligible(students)) throw new CustomValidationError("CUSTOM_REQUEST_NOT_ELIGIBLE");
  const bands = Math.ceil((students - BUSINESS_PLUS_STUDENTS) / CUSTOM_BAND_STUDENTS);
  return BUSINESS_PLUS_MONTHLY_MINOR + bands * CUSTOM_BAND_PRICE_MINOR;
}

/** Internal recommended non-owner team seats: ~1 per 200 students, never below BUSINESS_PLUS's 15. */
export function recommendCustomTeamMembers(students: number): number {
  return Math.max(BUSINESS_PLUS_TEAM, Math.ceil(students / CUSTOM_TEAM_STUDENTS_PER_SEAT));
}

export interface CustomRecommendationInput {
  requestedMaxActiveStudents: number;
  requestedMaxTeamMembers: number;
  billingCycle: BillingCycle;
}

export interface CustomRecommendation {
  eligible: boolean;
  recommendationVersion: number;
  currency: string;
  recommendedMonthlyMinor: number;
  recommendedAnnualMinor: number;
  /** Recommended price for the REQUESTED cycle (annual = monthly × 10, recommendation only). */
  recommendedPriceMinor: number;
  recommendedMaxTeamMembers: number;
  /** The requested team capacity exceeds the internal recommendation → the system flags it for the admin (never auto-rejected). */
  teamAboveRecommendation: boolean;
}

export function recommendCustom(input: CustomRecommendationInput): CustomRecommendation {
  if (!isCustomEligible(input.requestedMaxActiveStudents)) {
    return {
      eligible: false,
      recommendationVersion: RECOMMENDATION_VERSION,
      currency: BILLING_CURRENCY,
      recommendedMonthlyMinor: 0,
      recommendedAnnualMinor: 0,
      recommendedPriceMinor: 0,
      recommendedMaxTeamMembers: 0,
      teamAboveRecommendation: false,
    };
  }
  const monthly = recommendCustomMonthlyMinor(input.requestedMaxActiveStudents);
  const annual = monthly * ANNUAL_MULTIPLIER;
  const recommendedMaxTeamMembers = recommendCustomTeamMembers(input.requestedMaxActiveStudents);
  return {
    eligible: true,
    recommendationVersion: RECOMMENDATION_VERSION,
    currency: BILLING_CURRENCY,
    recommendedMonthlyMinor: monthly,
    recommendedAnnualMinor: annual,
    recommendedPriceMinor: input.billingCycle === "ANNUAL" ? annual : monthly,
    recommendedMaxTeamMembers,
    teamAboveRecommendation: input.requestedMaxTeamMembers > recommendedMaxTeamMembers,
  };
}

// ---------------------------------------------------------------------------
// Offer-price validation (admin authorized override). Pure.
// ---------------------------------------------------------------------------

export type CustomValidationReason =
  | "CUSTOM_REQUEST_NOT_ELIGIBLE"
  | "CUSTOM_OFFER_LIMIT_INVALID"
  | "CUSTOM_OFFER_PRICE_INVALID"
  | "CUSTOM_OFFER_PRICE_REASON_REQUIRED";

export class CustomValidationError extends Error {
  constructor(public readonly reason: CustomValidationReason) {
    super(`Custom validation failed: ${reason}`);
    this.name = "CustomValidationError";
  }
}

export interface CustomOfferDraft {
  maxActiveStudents: number;
  maxTeamMembers: number;
  billingCycle: BillingCycle;
  priceMinor: number;
  recommendationPriceMinor: number;
  adjustmentReason: string | null;
}

/**
 * Validate an admin-authored offer draft. Throws a typed reason on: sub-3000
 * students, negative team, non-positive/non-integer price, or a price that
 * differs from the recommendation WITHOUT a mandatory reason. EGP-only, integer
 * minor units. Returns the signed price difference (offer − recommendation).
 */
export function validateCustomOffer(draft: CustomOfferDraft): { priceDifferenceMinor: number } {
  if (!isCustomEligible(draft.maxActiveStudents)) throw new CustomValidationError("CUSTOM_OFFER_LIMIT_INVALID");
  if (!Number.isInteger(draft.maxTeamMembers) || draft.maxTeamMembers < 0) throw new CustomValidationError("CUSTOM_OFFER_LIMIT_INVALID");
  if (!Number.isInteger(draft.priceMinor) || draft.priceMinor <= 0) throw new CustomValidationError("CUSTOM_OFFER_PRICE_INVALID");
  const diff = draft.priceMinor - draft.recommendationPriceMinor;
  if (diff !== 0 && (!draft.adjustmentReason || draft.adjustmentReason.trim() === "")) {
    throw new CustomValidationError("CUSTOM_OFFER_PRICE_REASON_REQUIRED");
  }
  return { priceDifferenceMinor: diff };
}

// ---------------------------------------------------------------------------
// Lifecycle enums + shared DTOs (api ↔ web).
// ---------------------------------------------------------------------------

export const CUSTOM_REQUEST_STATUSES = ["PENDING_REVIEW", "OFFERED", "CANCELLED", "CLOSED"] as const;
export type CustomRequestStatus = (typeof CUSTOM_REQUEST_STATUSES)[number];

export const CUSTOM_OFFER_STATUSES = ["PENDING_CUSTOMER", "ACCEPTED", "APPLIED", "REJECTED", "EXPIRED", "SUPERSEDED", "CANCELLED"] as const;
export type CustomOfferStatus = (typeof CUSTOM_OFFER_STATUSES)[number];

/** When an ACCEPTED offer's terms take effect. IMMEDIATE = new subscription / standard→custom / custom capacity INCREASE; NEXT_RENEWAL = custom→custom DECREASE (scheduled, safer V1). */
export const CUSTOM_OFFER_EFFECTIVE_MODES = ["IMMEDIATE", "NEXT_RENEWAL"] as const;
export type CustomOfferEffectiveMode = (typeof CUSTOM_OFFER_EFFECTIVE_MODES)[number];

const billingCycleSchema = z.enum(BILLING_CYCLES as unknown as [BillingCycle, ...BillingCycle[]]);

/** Customer-created request payload — capacities + cycle + optional note ONLY. NEVER a price/limit-final/version. */
export const createCustomRequestSchema = z.object({
  requestedMaxActiveStudents: z.number().int().gt(MAX_STANDARD_PLAN_STUDENTS, "الباقة المخصصة تبدأ من أكثر من 3000 طالب"),
  requestedMaxTeamMembers: z.number().int().min(0),
  preferredBillingCycle: billingCycleSchema,
  customerNote: z.string().max(1000).optional(),
});
export type CreateCustomRequest = z.infer<typeof createCustomRequestSchema>;

/** Customer-facing offer view (no internal recommendation in V1). */
export const customOfferDtoSchema = z.object({
  id: z.string().uuid(),
  offerVersion: z.number().int(),
  maxActiveStudents: z.number().int(),
  maxTeamMembers: z.number().int(),
  billingCycle: billingCycleSchema,
  priceMinor: z.number().int(),
  currencyCode: z.string(),
  status: z.enum(CUSTOM_OFFER_STATUSES),
  effectiveMode: z.enum(CUSTOM_OFFER_EFFECTIVE_MODES),
  validUntil: z.string().nullable(),
  createdAt: z.string(),
});
export type CustomOfferDto = z.infer<typeof customOfferDtoSchema>;

/** Platform-admin offer view (adds the internal recommendation + override reason). */
export const platformCustomOfferDtoSchema = customOfferDtoSchema.extend({
  workspaceId: z.string().uuid(),
  customRequestId: z.string().uuid(),
  recommendationPriceMinor: z.number().int(),
  priceDifferenceMinor: z.number().int(),
  adjustmentReason: z.string().nullable(),
  commercialNote: z.string().nullable(),
  supersedesOfferId: z.string().uuid().nullable(),
  acceptedAt: z.string().nullable(),
});
export type PlatformCustomOfferDto = z.infer<typeof platformCustomOfferDtoSchema>;

/** Admin create-offer payload. Price authorized by the admin; reason required when it differs from the recommendation (also enforced server-side by validateCustomOffer). */
export const createCustomOfferSchema = z.object({
  customRequestId: z.string().uuid(),
  maxActiveStudents: z.number().int().gt(MAX_STANDARD_PLAN_STUDENTS),
  maxTeamMembers: z.number().int().min(0),
  billingCycle: billingCycleSchema,
  priceMinor: z.number().int().positive(),
  adjustmentReason: z.string().max(1000).optional(),
  commercialNote: z.string().max(1000).optional(),
  effectiveMode: z.enum(CUSTOM_OFFER_EFFECTIVE_MODES).default("IMMEDIATE"),
  validForDays: z.number().int().min(1).max(90).default(14),
});
export type CreateCustomOffer = z.infer<typeof createCustomOfferSchema>;

/** Customer creates a CUSTOM payment request — ONLY the accepted offer + method (server prices everything). */
export const createCustomPaymentRequestSchema = z.object({
  acceptedOfferId: z.string().uuid(),
  paymentMethod: billingPaymentMethodSchema,
});
export type CreateCustomPaymentRequest = z.infer<typeof createCustomPaymentRequestSchema>;

/** Customer request view (own lead). */
export const customRequestDtoSchema = z.object({
  id: z.string().uuid(),
  requestedMaxActiveStudents: z.number().int(),
  requestedMaxTeamMembers: z.number().int(),
  preferredBillingCycle: billingCycleSchema,
  status: z.enum(CUSTOM_REQUEST_STATUSES),
  createdAt: z.string(),
});
export type CustomRequestDto = z.infer<typeof customRequestDtoSchema>;

/** Customer-facing custom billing state (NO internal recommendation). */
export const customPlanStateSchema = z.object({
  /** Whether the workspace is at/near the top standard plan and may request custom. */
  customCtaVisible: z.boolean(),
  currentPlanCode: z.string().nullable(),
  request: customRequestDtoSchema.nullable(),
  offer: customOfferDtoSchema.nullable(),
});
export type CustomPlanStateDto = z.infer<typeof customPlanStateSchema>;

export const getCustomPlanStateResponseSchema = z.object({ customState: customPlanStateSchema });
export type GetCustomPlanStateResponse = z.infer<typeof getCustomPlanStateResponseSchema>;

/** Platform-admin request view (adds recommendation + customer context). */
export const platformCustomRequestDtoSchema = customRequestDtoSchema.extend({
  workspaceId: z.string().uuid(),
  workspaceName: z.string().nullable(),
  customerName: z.string().nullable(),
  customerNote: z.string().nullable(),
  recommendedPriceMinor: z.number().int(),
  recommendedMaxTeamMembers: z.number().int(),
  recommendationVersion: z.number().int(),
});
export type PlatformCustomRequestDto = z.infer<typeof platformCustomRequestDtoSchema>;

export const listPlatformCustomRequestsResponseSchema = z.object({ items: z.array(platformCustomRequestDtoSchema) });
export type ListPlatformCustomRequestsResponse = z.infer<typeof listPlatformCustomRequestsResponseSchema>;
