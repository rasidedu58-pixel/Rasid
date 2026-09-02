import { z } from "zod";
import type { SubscriptionStateDto } from "./billing";

/**
 * Billing lifecycle read-model vocabulary — Billing Engine, Phase 6
 * (MONTHLY-only). PURE (no DB/IO), so every rule here is unit-tested without a
 * database. Shared api↔web.
 *
 * Covers: subscription-status display copy + the display-only EXPIRING
 * derivation (No-Grace-in-V1: EXPIRING is never persisted, only shown when an
 * ACTIVE subscription is within the warning window and NOT already prepaid),
 * deterministic payment-request / custom-offer expiry derivation, the single
 * deterministic primary-action resolver (so the customer never sees competing
 * CTAs), and the billing-history / launch-readiness / platform-attention DTOs.
 */

// ---------------------------------------------------------------------------
// Subscription status display
// ---------------------------------------------------------------------------

/** Days before period_end within which an ACTIVE subscription is shown as "ينتهي قريبًا" (display-only; never persisted). */
export const EXPIRING_DISPLAY_WINDOW_DAYS = 7;

export interface SubscriptionStatusCopy {
  label: string;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
}

/** Arabic copy for every persisted subscription state, plus the display-only EXPIRING. Never render the raw enum. */
export const SUBSCRIPTION_STATUS_COPY: Record<SubscriptionStateDto, SubscriptionStatusCopy> = {
  TRIAL: { label: "الفترة التجريبية", tone: "info" },
  ACTIVE: { label: "نشط", tone: "success" },
  EXPIRING: { label: "ينتهي قريبًا", tone: "warning" },
  EXPIRED: { label: "منتهي", tone: "danger" },
  PAYMENT_FAILED: { label: "تعذّر تأكيد الدفع", tone: "danger" },
  CANCELLED_AT_PERIOD_END: { label: "سينتهي في نهاية الفترة", tone: "warning" },
};

/**
 * The DISPLAY status. A persisted ACTIVE subscription within
 * EXPIRING_DISPLAY_WINDOW_DAYS of its period_end AND with no future paid period
 * (nothing prepaid beyond period_end) is shown as EXPIRING — a display-only
 * projection, never written to the DB (No Grace Period in V1). Everything else
 * shows its persisted state verbatim.
 */
export function deriveDisplaySubscriptionStatus(input: {
  state: SubscriptionStateDto;
  daysUntilPeriodEnd: number | null;
  hasFuturePaidPeriod: boolean;
}): SubscriptionStateDto {
  if (
    input.state === "ACTIVE" &&
    !input.hasFuturePaidPeriod &&
    input.daysUntilPeriodEnd !== null &&
    input.daysUntilPeriodEnd >= 0 &&
    input.daysUntilPeriodEnd <= EXPIRING_DISPLAY_WINDOW_DAYS
  ) {
    return "EXPIRING";
  }
  return input.state;
}

// ---------------------------------------------------------------------------
// Deterministic expiry derivation (payment requests + custom offers)
// ---------------------------------------------------------------------------

/**
 * True when a PENDING payment request is effectively expired (expires_at < now)
 * even if the DB row has not yet been physically flipped by the worker sweep.
 * Reads defensively derive this so the UI never shows an expired request as
 * still actionable between sweeps. A non-PENDING request keeps its own status.
 */
export function paymentRequestIsExpired(input: { status: string; expiresAtMs: number | null; nowMs: number }): boolean {
  return input.status === "PENDING" && input.expiresAtMs !== null && input.expiresAtMs < input.nowMs;
}
/** The effective (display) status of a payment request — PENDING flips to EXPIRED once past expires_at. */
export function effectivePaymentRequestStatus(input: { status: string; expiresAtMs: number | null; nowMs: number }): string {
  return paymentRequestIsExpired(input) ? "EXPIRED" : input.status;
}

/** True when a PENDING_CUSTOMER offer is past valid_until (derived, defensive — same rationale as payment requests). */
export function customOfferIsExpired(input: { status: string; validUntilMs: number | null; nowMs: number }): boolean {
  return input.status === "PENDING_CUSTOMER" && input.validUntilMs !== null && input.validUntilMs < input.nowMs;
}
export function effectiveCustomOfferStatus(input: { status: string; validUntilMs: number | null; nowMs: number }): string {
  return customOfferIsExpired(input) ? "EXPIRED" : input.status;
}

// ---------------------------------------------------------------------------
// Primary-action resolver — ONE deterministic CTA (never competing CTAs)
// ---------------------------------------------------------------------------

/**
 * The single primary action the customer billing page surfaces. Ordering is
 * ACCESS-URGENCY first (money in flight / blocked access / a decision the
 * customer owes), then the plan ceiling, then renewal urgency, then soft
 * warnings, then informational. This arbitrates ACROSS the old per-panel CTAs
 * so at most ONE primary action ever shows; secondary actions (e.g. "upgrade
 * available") remain reachable but are not the page's headline.
 */
export const BILLING_PRIMARY_ACTIONS = [
  "CONTINUE_PAYMENT", // a PENDING payment request exists (not expired) — finish it
  "PAY_CUSTOM_OFFER", // an ACCEPTED custom offer awaits payment
  "RENEW", // EXPIRED / PAYMENT_FAILED — access blocked, no pending payment
  "REVIEW_CUSTOM_OFFER", // a PENDING_CUSTOMER offer awaits accept/reject
  "RETRY_PAYMENT", // the latest request was REJECTED/EXPIRED, none pending, sub still live
  "AT_CAPACITY", // usage at 100% of a plan limit
  "RENEW_SOON", // TRIAL/ACTIVE within the renewal window, no future paid period
  "NEAR_CAPACITY", // usage at 90% / 95%
  "REVIEW_SCHEDULED_DOWNGRADE", // an informational scheduled downgrade
  "NONE",
] as const;
export type BillingPrimaryAction = (typeof BILLING_PRIMARY_ACTIONS)[number];

/** For a capacity CTA, what the customer should do next depends on their tier. */
export const CAPACITY_CTA_TARGETS = ["UPGRADE", "REQUEST_CUSTOM", "MODIFY_CUSTOM"] as const;
export type CapacityCtaTarget = (typeof CAPACITY_CTA_TARGETS)[number];

export type BillingPlanTier = "STANDARD" | "BUSINESS_PLUS" | "CUSTOM";

/** Where a customer at/near their ceiling is sent: standard→upgrade, business+→request custom, custom→modify custom. */
export function capacityCtaTargetFor(tier: BillingPlanTier): CapacityCtaTarget {
  if (tier === "CUSTOM") return "MODIFY_CUSTOM";
  if (tier === "BUSINESS_PLUS") return "REQUEST_CUSTOM";
  return "UPGRADE";
}

export interface BillingPrimaryActionInput {
  state: SubscriptionStateDto;
  /** A payment request in PENDING and not past its expiry. */
  hasPendingPaymentRequest: boolean;
  /** The latest payment request is REJECTED or (effectively) EXPIRED, and none is pending. */
  hasFailedOrExpiredPaymentRequest: boolean;
  /** An accepted custom offer awaiting its payment. */
  hasAcceptedCustomOfferAwaitingPayment: boolean;
  /** A PENDING_CUSTOMER offer (not expired) awaiting the customer's accept/reject. */
  hasPendingCustomOffer: boolean;
  /** A scheduled downgrade recorded for the next renewal. */
  hasScheduledDowngrade: boolean;
  /** The highest crossed capacity band across students+team, or null below 90%. */
  capacityBand: 90 | 95 | 100 | null;
  tier: BillingPlanTier;
  /** A future paid period already covers beyond the current period_end (prepaid renewal / future plan). */
  hasFuturePaidPeriod: boolean;
  daysUntilPeriodEnd: number | null;
}

export interface BillingPrimaryActionResult {
  action: BillingPrimaryAction;
  /** Present only for AT_CAPACITY / NEAR_CAPACITY. */
  capacityTarget?: CapacityCtaTarget;
}

/** Renewal-CTA window: a TRIAL/ACTIVE subscription within this many days of period_end (and not prepaid) prompts a renewal. */
export const RENEWAL_CTA_WINDOW_DAYS = 7;

export function resolveBillingPrimaryAction(input: BillingPrimaryActionInput): BillingPrimaryActionResult {
  // 1. Money already in flight — finish it before anything else.
  if (input.hasPendingPaymentRequest) return { action: "CONTINUE_PAYMENT" };
  // 2. An accepted custom offer the customer chose but hasn't paid.
  if (input.hasAcceptedCustomOfferAwaitingPayment) return { action: "PAY_CUSTOM_OFFER" };
  // 3. Access is blocked and no payment is pending — renewal is the only way back.
  if (input.state === "EXPIRED" || input.state === "PAYMENT_FAILED") return { action: "RENEW" };
  // 4. A live offer the customer owes a decision on.
  if (input.hasPendingCustomOffer) return { action: "REVIEW_CUSTOM_OFFER" };
  // 5. The last attempt failed/expired while still live — offer a retry.
  if (input.hasFailedOrExpiredPaymentRequest) return { action: "RETRY_PAYMENT" };
  // 6. At the plan ceiling — cannot add more without a plan change.
  if (input.capacityBand === 100) return { action: "AT_CAPACITY", capacityTarget: capacityCtaTargetFor(input.tier) };
  // 7. Renewal is imminent and nothing is prepaid.
  if (
    (input.state === "TRIAL" || input.state === "ACTIVE") &&
    !input.hasFuturePaidPeriod &&
    input.daysUntilPeriodEnd !== null &&
    input.daysUntilPeriodEnd >= 0 &&
    input.daysUntilPeriodEnd <= RENEWAL_CTA_WINDOW_DAYS
  ) {
    return { action: "RENEW_SOON" };
  }
  // 8. Approaching the ceiling — a soft warning.
  if (input.capacityBand === 90 || input.capacityBand === 95) {
    return { action: "NEAR_CAPACITY", capacityTarget: capacityCtaTargetFor(input.tier) };
  }
  // 9. A scheduled downgrade — purely informational, lowest priority.
  if (input.hasScheduledDowngrade) return { action: "REVIEW_SCHEDULED_DOWNGRADE" };
  return { action: "NONE" };
}

// ---------------------------------------------------------------------------
// Billing history read model (customer-safe unified timeline)
// ---------------------------------------------------------------------------

export const BILLING_HISTORY_EVENT_TYPES = [
  "PAYMENT_REQUEST_CREATED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_REJECTED",
  "PAYMENT_REVERSED",
  "PLAN_UPGRADED",
  "DOWNGRADE_SCHEDULED",
  "CUSTOM_OFFER_ACCEPTED",
  "CUSTOM_APPLIED",
  "RENEWAL",
] as const;
export type BillingHistoryEventType = (typeof BILLING_HISTORY_EVENT_TYPES)[number];

export const billingHistoryItemSchema = z.object({
  type: z.enum(BILLING_HISTORY_EVENT_TYPES),
  occurredAt: z.string(),
  /** Human-readable Arabic summary — customer-safe, never raw audit JSON or internal notes. */
  title: z.string(),
  planCode: z.string().nullable(),
  amountMinor: z.number().int().nullable(),
  currencyCode: z.string().nullable(),
  /** e.g. the payment request humanCode — customer-safe reference, or null. */
  reference: z.string().nullable(),
});
export type BillingHistoryItem = z.infer<typeof billingHistoryItemSchema>;

export const listBillingHistoryResponseSchema = z.object({
  items: z.array(billingHistoryItemSchema),
  page: z.object({ nextCursor: z.string().nullable(), hasNext: z.boolean() }),
});
export type ListBillingHistoryResponse = z.infer<typeof listBillingHistoryResponseSchema>;

// ---------------------------------------------------------------------------
// Platform attention queue (deterministic severity + age, no scoring/AI)
// ---------------------------------------------------------------------------

export const BILLING_ATTENTION_ITEM_KINDS = [
  "PAYMENT_PENDING_STALE",
  "PAYMENT_REJECTED_AWAITING_RETRY",
  "CUSTOM_REQUEST_PENDING",
  "CUSTOM_OFFER_NEAR_EXPIRY",
  "SUBSCRIPTION_EXPIRING_SOON",
  "CAPACITY_AT_LIMIT",
] as const;
export type BillingAttentionItemKind = (typeof BILLING_ATTENTION_ITEM_KINDS)[number];

export const BILLING_ATTENTION_SEVERITIES = ["HIGH", "MEDIUM", "LOW"] as const;
export type BillingAttentionSeverity = (typeof BILLING_ATTENTION_SEVERITIES)[number];

/** Fixed severity per kind — deterministic, no fuzzy scoring. */
export const BILLING_ATTENTION_KIND_SEVERITY: Record<BillingAttentionItemKind, BillingAttentionSeverity> = {
  PAYMENT_PENDING_STALE: "HIGH",
  CUSTOM_OFFER_NEAR_EXPIRY: "HIGH",
  CAPACITY_AT_LIMIT: "MEDIUM",
  CUSTOM_REQUEST_PENDING: "MEDIUM",
  PAYMENT_REJECTED_AWAITING_RETRY: "MEDIUM",
  SUBSCRIPTION_EXPIRING_SOON: "LOW",
};

const SEVERITY_RANK: Record<BillingAttentionSeverity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/** A pending payment older than this many hours is "stale" and surfaces in the attention queue. */
export const PAYMENT_PENDING_STALE_HOURS = 24;

export const billingAttentionItemSchema = z.object({
  kind: z.enum(BILLING_ATTENTION_ITEM_KINDS),
  severity: z.enum(BILLING_ATTENTION_SEVERITIES),
  workspaceId: z.string().uuid(),
  workspaceName: z.string().nullable(),
  /** Customer-safe Arabic one-line summary. */
  title: z.string(),
  /** ISO timestamp the item has been waiting since — drives the age sort. */
  since: z.string(),
  /** Deep-link target on the platform side (e.g. "payment-requests", "custom-plans"). */
  target: z.string(),
  /** The related entity id (payment request / custom request / offer / subscription), or null. */
  entityId: z.string().nullable(),
  // --- CAPACITY_AT_LIMIT detail (present only for that kind) ---
  resource: z.enum(["STUDENTS", "TEAM"]).nullable().optional(),
  currentUsage: z.number().int().nullable().optional(),
  limit: z.number().int().nullable().optional(),
  currentPlan: z.string().nullable().optional(),
  /** Next-step context for a capacity item: upgrade / request custom / adjust custom. */
  capacityAction: z.enum(CAPACITY_CTA_TARGETS).nullable().optional(),
});
export type BillingAttentionItem = z.infer<typeof billingAttentionItemSchema>;

// ---------------------------------------------------------------------------
// Platform billing history (read-only, cross-customer). Curated — never raw
// audit JSON, never a recommendation / adjustment reason / commercial note.
// ---------------------------------------------------------------------------

export const PLATFORM_BILLING_HISTORY_EVENT_TYPES = [
  "PAYMENT_REQUEST_CREATED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_REJECTED",
  "PAYMENT_REVERSED",
  "SUBSCRIPTION_ACTIVATED",
  "RENEWAL",
  "PLAN_UPGRADED",
  "DOWNGRADE_SCHEDULED",
  "DOWNGRADE_CANCELLED",
  "CUSTOM_REQUEST_CREATED",
  "CUSTOM_OFFER_CREATED",
  "CUSTOM_OFFER_ACCEPTED",
  "CUSTOM_OFFER_APPLIED",
  "CUSTOM_OFFER_SUPERSEDED",
] as const;
export type PlatformBillingHistoryEventType = (typeof PLATFORM_BILLING_HISTORY_EVENT_TYPES)[number];

export const PLATFORM_BILLING_HISTORY_CATEGORIES = ["PAYMENT", "SUBSCRIPTION", "CUSTOM"] as const;
export type PlatformBillingHistoryCategory = (typeof PLATFORM_BILLING_HISTORY_CATEGORIES)[number];

/** Which filter category an event belongs to. Pure. */
export function platformBillingHistoryCategoryOf(type: PlatformBillingHistoryEventType): PlatformBillingHistoryCategory {
  if (type.startsWith("PAYMENT_")) return "PAYMENT";
  if (type.startsWith("CUSTOM_")) return "CUSTOM";
  return "SUBSCRIPTION"; // SUBSCRIPTION_ACTIVATED / RENEWAL / PLAN_UPGRADED / DOWNGRADE_*
}

export const platformBillingHistoryItemSchema = z.object({
  type: z.enum(PLATFORM_BILLING_HISTORY_EVENT_TYPES),
  category: z.enum(PLATFORM_BILLING_HISTORY_CATEGORIES),
  occurredAt: z.string(),
  workspaceId: z.string().uuid(),
  workspaceName: z.string().nullable(),
  /** Curated Arabic summary — never raw audit JSON, never internal notes. */
  title: z.string(),
  planCode: z.string().nullable(),
  amountMinor: z.number().int().nullable(),
  currencyCode: z.string().nullable(),
  /** Customer-safe reference (e.g. the RSD human code), or null. */
  reference: z.string().nullable(),
});
export type PlatformBillingHistoryItem = z.infer<typeof platformBillingHistoryItemSchema>;

export const listPlatformBillingHistoryResponseSchema = z.object({
  items: z.array(platformBillingHistoryItemSchema),
  page: z.object({ nextCursor: z.string().nullable(), hasNext: z.boolean() }),
});
export type ListPlatformBillingHistoryResponse = z.infer<typeof listPlatformBillingHistoryResponseSchema>;

/** Deterministic ordering: severity first, then oldest-waiting first. Pure comparator (stable-sort friendly). */
export function compareBillingAttentionItems(a: BillingAttentionItem, b: BillingAttentionItem): number {
  const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (s !== 0) return s;
  return new Date(a.since).getTime() - new Date(b.since).getTime();
}

export const listBillingAttentionResponseSchema = z.object({ items: z.array(billingAttentionItemSchema) });
export type ListBillingAttentionResponse = z.infer<typeof listBillingAttentionResponseSchema>;

// ---------------------------------------------------------------------------
// Launch readiness (platform-only; boolean/status, never secrets)
// ---------------------------------------------------------------------------

export const LAUNCH_READINESS_CHECKS = [
  "MIGRATIONS_CURRENT",
  "BILLING_TABLES_PRESENT",
  "WORKER_HEALTHY",
  "NO_DEAD_OUTBOX",
  "PAYMENT_CHANNELS_CONFIGURED",
  "CUSTOM_FLOWS_ENABLED",
] as const;
export type LaunchReadinessCheck = (typeof LAUNCH_READINESS_CHECKS)[number];

export const launchReadinessItemSchema = z.object({
  check: z.enum(LAUNCH_READINESS_CHECKS),
  ok: z.boolean(),
  /** Short Arabic status detail — never a secret, connection string, or credential. */
  detail: z.string(),
});
export type LaunchReadinessItem = z.infer<typeof launchReadinessItemSchema>;

export const launchReadinessResponseSchema = z.object({
  /** launch-readiness is the AND of every check — distinct from app health, which stays green regardless. */
  ready: z.boolean(),
  checks: z.array(launchReadinessItemSchema),
});
export type LaunchReadinessResponse = z.infer<typeof launchReadinessResponseSchema>;

/** ready = every check passed. Pure. */
export function computeLaunchReady(checks: LaunchReadinessItem[]): boolean {
  return checks.length > 0 && checks.every((c) => c.ok);
}
