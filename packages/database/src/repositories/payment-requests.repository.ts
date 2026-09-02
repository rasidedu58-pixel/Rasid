/**
 * Payment Requests + manual confirmation — Billing Engine, Phase 3.
 *
 * The commercial write path: create a PENDING request (price SERVER-computed
 * from the plan catalog — a client amount is never trusted), then a platform
 * admin confirms (→ immutable subscription_payment + subscription ACTIVE with a
 * commercial snapshot, all in ONE transaction) or rejects. Race-safe via
 * SELECT ... FOR UPDATE on the request row; idempotent via the request's status
 * guard + the subscription_payments UNIQUE(payment_request_id) backstop.
 */
import { randomInt } from "node:crypto";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { DateTime } from "luxon";
import {
  assertDowngradeTransition,
  assertUpgradeTransition,
  computeUpgradeProrationOverPeriods,
  evaluateDowngradeUsage,
  isDowngrade,
  isStandardPlanCode,
  isUpgrade,
  resolveCapacityThresholdBand,
  resolveCatalogPrice,
  resolvePlanLimits,
  type BillingCycle,
  type PlanCode,
  type StandardPlanCode,
  type SubscriptionStateDto,
} from "@academic-precision/contracts";
import type { Db } from "./identity.repository";
import { paymentRequests } from "../schema/payment-requests";
import { subscriptionPayments, subscriptionPaymentReversals } from "../schema/subscription-payments";
import { subscriptions } from "../schema/subscriptions";
import { customPlanOffers } from "../schema/custom-plans";
import { workspaces } from "../schema/workspaces";
import { users } from "../schema/identity";
import { auditEvents } from "../schema/audit";
import { outboxEvents } from "../schema/outbox";
import { notifications } from "../schema/notifications";
import { applySubscriptionTransitionOnTx, SUBSCRIPTION_VERSION_CONFLICT, type SubscriptionRow } from "./subscriptions.repository";
import { appendSubscriptionPeriodOnTx, loadLedgerRowsForSubscription } from "./subscription-periods.repository";
import { effectiveRowAt, hasFutureDifferentPlanPeriod, paidThroughMs, resolveEffectiveSegments, toProrationSlices } from "../billing/period-ledger";
import { assertMonthlyBillingCycle } from "../billing/billing-cycle";
import { findCurrentMonthId, getActiveStudentCountForMonth, getActiveTeamUsage } from "../billing/capacity";
import { findCustomOfferForWorkspace, markOfferAppliedOnTx, CustomOfferNotAcceptableError, CustomOfferNotFoundError, CustomOfferAlreadyAppliedError } from "./custom-plans.repository";

export type PaymentRequestRow = typeof paymentRequests.$inferSelect;
export type SubscriptionPaymentRow = typeof subscriptionPayments.$inferSelect;

const DEFAULT_REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days to pay + send proof
const PAID_STATE = "ACTIVE";
const ACTIVE_SUBSCRIPTION_STATE = "ACTIVE";

// ---------------------------------------------------------------------------
// Typed domain errors — mapped to their 4xx contract code by the API's global
// filter (via the `isBillingDomainError` marker), never a raw 500.
// ---------------------------------------------------------------------------

export abstract class BillingRequestError extends Error {
  readonly isBillingDomainError = true as const;
  abstract readonly code: string;
  abstract readonly httpStatus: number;
  readonly details?: Record<string, unknown>;
}
export class PaymentRequestNotFoundError extends BillingRequestError {
  readonly code = "PAYMENT_REQUEST_NOT_FOUND";
  readonly httpStatus = 404;
  constructor() { super("طلب الدفع غير موجود."); this.name = "PaymentRequestNotFoundError"; }
}
export class PaymentRequestNotPendingError extends BillingRequestError {
  readonly code = "PAYMENT_REQUEST_NOT_PENDING";
  readonly httpStatus = 409;
  constructor() { super("لم يعد طلب الدفع في حالة الانتظار."); this.name = "PaymentRequestNotPendingError"; }
}
export class PaymentRequestExpiredError extends BillingRequestError {
  readonly code = "PAYMENT_REQUEST_EXPIRED";
  readonly httpStatus = 409;
  constructor() { super("انتهت صلاحية طلب الدفع. أنشئ طلبًا جديدًا."); this.name = "PaymentRequestExpiredError"; }
}
export class PaymentRequestStaleError extends BillingRequestError {
  readonly code = "PAYMENT_REQUEST_STALE";
  readonly httpStatus = 409;
  constructor() { super("تغيّرت حالة الاشتراك منذ إنشاء الطلب. أعد المحاولة."); this.name = "PaymentRequestStaleError"; }
}
export class PlanChangeNotSupportedError extends BillingRequestError {
  readonly code = "PLAN_CHANGE_NOT_SUPPORTED";
  readonly httpStatus = 409;
  constructor() { super("تغيير الباقة (ترقية/تنزيل) غير متاح بعد — التجديد على نفس الباقة فقط."); this.name = "PlanChangeNotSupportedError"; }
}
export class NoCatalogPriceError extends BillingRequestError {
  readonly code = "NO_CATALOG_PRICE";
  readonly httpStatus = 400;
  constructor() { super("لا يوجد سعر معتمد لهذه الباقة."); this.name = "NoCatalogPriceError"; }
}
// ── Phase 4: plan-change (upgrade / downgrade) domain errors ────────────────
export class SubscriptionNotActiveError extends BillingRequestError {
  readonly code = "SUBSCRIPTION_NOT_ACTIVE";
  readonly httpStatus = 409;
  constructor() { super("تغيير الباقة متاح فقط لاشتراك فعّال."); this.name = "SubscriptionNotActiveError"; }
}
export class NotAnUpgradeError extends BillingRequestError {
  readonly code = "NOT_AN_UPGRADE";
  readonly httpStatus = 409;
  constructor() { super("الباقة المطلوبة ليست ترقية. لخفض الباقة استخدم الجدولة عند التجديد."); this.name = "NotAnUpgradeError"; }
}
export class NotADowngradeError extends BillingRequestError {
  readonly code = "NOT_A_DOWNGRADE";
  readonly httpStatus = 409;
  constructor() { super("الباقة المطلوبة ليست خفضًا."); this.name = "NotADowngradeError"; }
}
export class CrossCycleUpgradeNotSupportedError extends BillingRequestError {
  readonly code = "CROSS_CYCLE_UPGRADE_NOT_SUPPORTED";
  readonly httpStatus = 409;
  constructor() { super("لا يمكن تغيير دورة الفوترة (شهري/سنوي) أثناء الترقية حاليًا."); this.name = "CrossCycleUpgradeNotSupportedError"; }
}
export class UpgradeProrationNonPositiveError extends BillingRequestError {
  readonly code = "UPGRADE_PRORATION_NON_POSITIVE";
  readonly httpStatus = 409;
  constructor() { super("لا يوجد مبلغ فرق مستحق للترقية على الوقت المتبقي."); this.name = "UpgradeProrationNonPositiveError"; }
}
export class DowngradeBlockedByUsageError extends BillingRequestError {
  readonly code = "DOWNGRADE_BLOCKED_BY_USAGE";
  readonly httpStatus = 409;
  constructor(details: { currentStudents: number; targetStudentLimit: number; currentTeamMembers: number; targetTeamLimit: number }) {
    super("استخدامك الحالي يتجاوز حدود الباقة الأقل. قلّل الاستخدام قبل خفض الباقة.");
    this.name = "DowngradeBlockedByUsageError";
    (this as { details?: Record<string, unknown> }).details = details;
  }
}
export class NoPendingDowngradeError extends BillingRequestError {
  readonly code = "NO_PENDING_DOWNGRADE";
  readonly httpStatus = 409;
  constructor() { super("لا يوجد خفض باقة مجدول."); this.name = "NoPendingDowngradeError"; }
}
export class FuturePlanChangeExistsError extends BillingRequestError {
  readonly code = "FUTURE_PLAN_CHANGE_EXISTS";
  readonly httpStatus = 409;
  constructor() {
    super("يوجد تغيير مدفوع/مجدول للباقة في فترة قادمة؛ لا يمكن تنفيذ ترقية جديدة قبل بدء/تسوية هذا التغيير.");
    this.name = "FuturePlanChangeExistsError";
  }
}

// ---------------------------------------------------------------------------
// Human-readable RSD code — Crockford-ish alphabet (no 0/1/O/I/L/U) so it can't
// be misread when copied by hand. For human matching ONLY, never authorization.
// ---------------------------------------------------------------------------

export const HUMAN_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_ALPHABET = HUMAN_CODE_ALPHABET;
export function generateHumanCode(): string {
  let body = "";
  for (let i = 0; i < 5; i += 1) body += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `RSD-${body}`;
}

/** +1 calendar month / +12 calendar months from `start` (UTC calendar math — Jan 31 → Feb 28/29 clamps deterministically via luxon). */
export function computePeriodEnd(start: Date, cycle: BillingCycle): Date {
  const dt = DateTime.fromJSDate(start, { zone: "utc" });
  return (cycle === "ANNUAL" ? dt.plus({ years: 1 }) : dt.plus({ months: 1 })).toJSDate();
}

/**
 * The subscription period after a confirmed payment — the model that makes early
 * renewal lose no days while keeping [period_start, period_end] ALWAYS exactly
 * ONE nominal cycle (never a growing "giant period"):
 *
 *   • NEW_SUBSCRIPTION (from TRIAL/EXPIRED/…): the new cycle starts NOW.
 *       period_start = now,                   period_end = now + cycle.
 *   • RENEWAL (ACTIVE, paid early): the new cycle begins where the current paid
 *     term ENDS, so the remaining days stay covered and stack on top.
 *       period_start = max(currentPeriodEnd, now),  period_end = period_start + cycle.
 *
 * `period_end` is the authoritative paid-through / expiry date; `period_start`
 * anchors the current (final) cycle and may be in the future after early renewal.
 *
 * PRORATION well-definedness (future Phase 4, no change needed here): the nominal
 * cycle length is exactly (period_end - period_start); the unused credit of the
 * current plan is `current_price_minor * (period_end - now) / (period_end - period_start)`.
 * With stacked early renewals the numerator can exceed the denominator — correct:
 * the customer is credited for ALL prepaid time at the current price. The formula
 * needs no `period_start = one-cycle-ago` assumption, so this model does not
 * distort or block Phase-4 proration.
 */
export function computeConfirmedPeriod(input: {
  actionType: string;
  currentPeriodEnd: Date | null;
  now: Date;
  cycle: BillingCycle;
}): { periodStart: Date; periodEnd: Date } {
  const extendFromCurrentEnd =
    input.actionType === "RENEWAL" && input.currentPeriodEnd !== null && input.currentPeriodEnd.getTime() > input.now.getTime();
  const periodStart = extendFromCurrentEnd ? (input.currentPeriodEnd as Date) : input.now;
  return { periodStart, periodEnd: computePeriodEnd(periodStart, input.cycle) };
}

// ---------------------------------------------------------------------------
// Create (tenant owner, app_runtime).
// ---------------------------------------------------------------------------

export interface CreatePaymentRequestInput {
  workspaceId: string;
  requestedByUserId: string;
  planCode: StandardPlanCode;
  billingCycle: BillingCycle;
  paymentMethod: "INSTAPAY" | "VODAFONE_CASH";
}

export async function createPaymentRequestTransaction(
  db: Db,
  input: CreatePaymentRequestInput,
): Promise<{ paymentRequest: PaymentRequestRow; reused: boolean }> {
  // MONTHLY-only trust boundary (V1) — reject a new subscription/renewal/upgrade
  // request on any non-monthly cycle with a typed 4xx, never a silent convert.
  assertMonthlyBillingCycle(input.billingCycle);
  return db.transaction(async (tx) => {
    const [subscription] = await tx
      .select({
        id: subscriptions.id,
        version: subscriptions.version,
        state: subscriptions.state,
        planCode: subscriptions.planCode,
        billingCycle: subscriptions.billingCycle,
        currentPriceMinor: subscriptions.currentPriceMinor,
        periodStart: subscriptions.periodStart,
        periodEnd: subscriptions.periodEnd,
        pendingPlanCode: subscriptions.pendingPlanCode,
        pendingBillingCycle: subscriptions.pendingBillingCycle,
      })
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, input.workspaceId))
      .limit(1);
    if (!subscription) throw new PaymentRequestNotFoundError(); // no subscription row = misprovisioned workspace

    const isActive = subscription.state === ACTIVE_SUBSCRIPTION_STATE;
    const quote = await resolvePaymentRequestQuote(tx, subscription, input);

    // Dedup / anti-spam: reuse an identical PENDING request; otherwise cancel any
    // existing PENDING (the partial-unique index allows only one at a time).
    const [existingPending] = await tx
      .select()
      .from(paymentRequests)
      .where(and(eq(paymentRequests.workspaceId, input.workspaceId), eq(paymentRequests.status, "PENDING")))
      .limit(1);
    if (existingPending) {
      const sameSelection =
        existingPending.targetPlanCode === quote.targetPlanCode &&
        existingPending.billingCycle === input.billingCycle &&
        existingPending.paymentMethod === input.paymentMethod &&
        existingPending.actionType === quote.actionType;
      if (sameSelection) return { paymentRequest: existingPending, reused: true };
      await tx
        .update(paymentRequests)
        .set({ status: "CANCELLED", updatedAt: new Date(), version: existingPending.version + 1 })
        .where(eq(paymentRequests.id, existingPending.id));
    }

    const expiresAt = new Date(Date.now() + DEFAULT_REQUEST_TTL_MS);
    void isActive;

    // Insert with a unique human code — retry on the (rare) collision.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        const [row] = await tx
          .insert(paymentRequests)
          .values({
            workspaceId: input.workspaceId,
            requestedByUserId: input.requestedByUserId,
            humanCode: generateHumanCode(),
            actionType: quote.actionType,
            targetPlanCode: quote.targetPlanCode,
            billingCycle: input.billingCycle,
            amountMinor: quote.amountMinor,
            currencyCode: quote.currencyCode,
            paymentMethod: input.paymentMethod,
            status: "PENDING",
            boundSubscriptionVersion: subscription.version,
            quoteSnapshotJson: quote.snapshot,
            expiresAt,
          })
          .returning();
        if (!row) throw new Error("Failed to insert payment_requests row.");

        await tx.insert(outboxEvents).values({
          workspaceId: input.workspaceId,
          eventType: "PaymentRequestCreated",
          aggregateType: "PaymentRequest",
          aggregateId: row.id,
          payload: { paymentRequestId: row.id, planCode: quote.targetPlanCode, amountMinor: quote.amountMinor, actionType: quote.actionType },
        });
        await tx.insert(auditEvents).values({
          workspaceId: input.workspaceId,
          actorUserId: input.requestedByUserId,
          actorMembershipId: null,
          action: "billing.payment_request.created",
          entityType: "payment_request",
          entityId: row.id,
          afterJson: { humanCode: row.humanCode, actionType: quote.actionType, planCode: quote.targetPlanCode, billingCycle: input.billingCycle, amountMinor: quote.amountMinor, method: input.paymentMethod },
        });
        return { paymentRequest: row, reused: false };
      } catch (err) {
        if (isHumanCodeCollision(err) && attempt < 5) continue;
        throw err;
      }
    }
    throw new Error("Failed to allocate a unique payment-request code after several attempts.");
  });
}

interface QuoteSubscription {
  id: string;
  version: number;
  state: string;
  planCode: string | null;
  billingCycle: string | null;
  currentPriceMinor: number | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  pendingPlanCode: string | null;
  pendingBillingCycle: string | null;
}

interface ResolvedQuote {
  actionType: "NEW_SUBSCRIPTION" | "RENEWAL" | "UPGRADE";
  targetPlanCode: StandardPlanCode;
  amountMinor: number;
  currencyCode: string;
  snapshot: Record<string, unknown>;
}

/**
 * Determine {action, target plan, amount, immutable quote snapshot} server-side.
 * The client sends ONLY {planCode, billingCycle, method} — never a price.
 *   • Not ACTIVE            → NEW_SUBSCRIPTION at catalog price.
 *   • ACTIVE, same plan     → RENEWAL at catalog price. If a downgrade is
 *     scheduled, the renewal instead targets the PENDING (lower) plan (§21),
 *     after re-validating usage.
 *   • ACTIVE, higher plan   → UPGRADE, amount = exact ledger proration (§8).
 *   • ACTIVE, lower plan     → NOT_AN_UPGRADE (downgrade is a schedule, not a payment).
 */
async function resolvePaymentRequestQuote(tx: Db, sub: QuoteSubscription, input: CreatePaymentRequestInput): Promise<ResolvedQuote> {
  const catalog = (plan: StandardPlanCode) => {
    const p = resolveCatalogPrice(plan, input.billingCycle);
    if (!p) throw new NoCatalogPriceError();
    return p;
  };

  if (sub.state !== ACTIVE_SUBSCRIPTION_STATE) {
    const price = catalog(input.planCode);
    return {
      actionType: "NEW_SUBSCRIPTION",
      targetPlanCode: input.planCode,
      amountMinor: price.amountMinor,
      currencyCode: price.currency,
      snapshot: { kind: "NEW_SUBSCRIPTION", planCode: input.planCode, billingCycle: input.billingCycle, amountMinor: price.amountMinor, currency: price.currency, planPriceVersion: price.planPriceVersion, subscriptionVersion: sub.version },
    };
  }

  const current = sub.planCode;
  if (!current || !isStandardPlanCode(current)) {
    // ACTIVE CUSTOM/legacy plan → plan changes here are out of scope.
    if (current === input.planCode) return renewalQuote(input, sub, input.planCode, catalog);
    throw new PlanChangeNotSupportedError();
  }

  // Same plan → RENEWAL (which may be redirected to a scheduled downgrade target).
  if (current === input.planCode) {
    if (sub.pendingPlanCode && isStandardPlanCode(sub.pendingPlanCode)) {
      // §21: a scheduled downgrade makes the NEXT renewal target the pending plan
      // (same cycle in V1 — the schedule enforces this).
      await assertDowngradeUsageFitsOnTx(tx, input.workspaceId, sub.pendingPlanCode);
      return renewalQuote(input, sub, sub.pendingPlanCode, catalog);
    }
    return renewalQuote(input, sub, current, catalog);
  }

  // Different plan while ACTIVE → upgrade or (rejected) downgrade.
  if (isDowngrade(current, input.planCode)) throw new NotAnUpgradeError();
  if (!isUpgrade(current, input.planCode)) throw new PlanChangeNotSupportedError();

  // UPGRADE (same-cycle only in V1).
  assertUpgradeTransition(current, input.planCode);
  if (sub.billingCycle && sub.billingCycle !== input.billingCycle) throw new CrossCycleUpgradeNotSupportedError();
  const nowMs = Date.now();
  const rows = await loadLedgerRowsForSubscription(tx, sub.id);
  // Block if a plan change is already in flight: a scheduled (pending) downgrade,
  // OR a PAID future period at a DIFFERENT plan (early-renewed downgrade). We
  // never silently supersede / cancel / refund that future period in V1.
  if (sub.pendingPlanCode || hasFutureDifferentPlanPeriod(rows, nowMs)) throw new FuturePlanChangeExistsError();
  const target = catalog(input.planCode);
  const slices = toProrationSlices(resolveEffectiveSegments(rows, nowMs));
  const proration = computeUpgradeProrationOverPeriods({
    targetPlan: input.planCode,
    billingCycle: input.billingCycle,
    targetCatalogPriceMinor: target.amountMinor,
    nowMs,
    periods: slices,
  });
  if (proration.kind === "NOT_SAME_CYCLE") throw new CrossCycleUpgradeNotSupportedError();
  if (proration.kind !== "DUE") throw new UpgradeProrationNonPositiveError();
  return {
    actionType: "UPGRADE",
    targetPlanCode: input.planCode,
    amountMinor: proration.amountDueMinor,
    currencyCode: target.currency,
    snapshot: {
      kind: "UPGRADE",
      currentPlanCode: current,
      targetPlanCode: input.planCode,
      billingCycle: input.billingCycle,
      currentPriceMinorSnapshot: sub.currentPriceMinor,
      targetPriceMinor: target.amountMinor,
      calculatedAmountMinor: proration.amountDueMinor,
      creditRemainingMinor: proration.creditRemainingMinor,
      targetRemainingCostMinor: proration.targetRemainingCostMinor,
      currentPeriodStart: sub.periodStart?.toISOString() ?? null,
      currentPeriodEnd: sub.periodEnd?.toISOString() ?? null,
      quoteTimestamp: new Date(nowMs).toISOString(),
      planPriceVersion: target.planPriceVersion,
      subscriptionVersion: sub.version,
    },
  };
}

function renewalQuote(
  input: CreatePaymentRequestInput,
  sub: QuoteSubscription,
  targetPlan: StandardPlanCode,
  catalog: (plan: StandardPlanCode) => { amountMinor: number; currency: string; planPriceVersion: number },
): ResolvedQuote {
  const price = catalog(targetPlan);
  return {
    actionType: "RENEWAL",
    targetPlanCode: targetPlan,
    amountMinor: price.amountMinor,
    currencyCode: price.currency,
    snapshot: { kind: "RENEWAL", planCode: targetPlan, billingCycle: input.billingCycle, amountMinor: price.amountMinor, currency: price.currency, planPriceVersion: price.planPriceVersion, subscriptionVersion: sub.version },
  };
}

function isHumanCodeCollision(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("payment_requests_human_code_unique");
}

// ---------------------------------------------------------------------------
// CUSTOM payment requests — Phase 5. Always server-priced from an ACCEPTED,
// authoritative custom_plan_offer (the client never sends amount/limits). The
// generic confirm path then activates CUSTOM (custom limits carried in the
// immutable quote snapshot + the ledger period).
// ---------------------------------------------------------------------------

interface ServerPricedRequestInput {
  workspaceId: string;
  requestedByUserId: string;
  actionType: "NEW_SUBSCRIPTION" | "RENEWAL" | "UPGRADE";
  targetPlanCode: string;
  billingCycle: string;
  amountMinor: number;
  currencyCode: string;
  paymentMethod: "INSTAPAY" | "VODAFONE_CASH";
  boundSubscriptionVersion: number;
  quoteSnapshot: Record<string, unknown>;
}

/** Shared insert: cancel any prior PENDING, insert with a unique human code, emit outbox + audit. */
async function insertServerPricedRequestOnTx(tx: Db, input: ServerPricedRequestInput): Promise<PaymentRequestRow> {
  const [existingPending] = await tx.select().from(paymentRequests).where(and(eq(paymentRequests.workspaceId, input.workspaceId), eq(paymentRequests.status, "PENDING"))).limit(1);
  if (existingPending) {
    await tx.update(paymentRequests).set({ status: "CANCELLED", updatedAt: new Date(), version: existingPending.version + 1 }).where(eq(paymentRequests.id, existingPending.id));
  }
  const expiresAt = new Date(Date.now() + DEFAULT_REQUEST_TTL_MS);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const [row] = await tx
        .insert(paymentRequests)
        .values({
          workspaceId: input.workspaceId,
          requestedByUserId: input.requestedByUserId,
          humanCode: generateHumanCode(),
          actionType: input.actionType,
          targetPlanCode: input.targetPlanCode,
          billingCycle: input.billingCycle,
          amountMinor: input.amountMinor,
          currencyCode: input.currencyCode,
          paymentMethod: input.paymentMethod,
          status: "PENDING",
          boundSubscriptionVersion: input.boundSubscriptionVersion,
          quoteSnapshotJson: input.quoteSnapshot,
          expiresAt,
        })
        .returning();
      if (!row) throw new Error("Failed to insert payment_requests row.");
      await tx.insert(outboxEvents).values({ workspaceId: input.workspaceId, eventType: "PaymentRequestCreated", aggregateType: "PaymentRequest", aggregateId: row.id, payload: { paymentRequestId: row.id, planCode: input.targetPlanCode, amountMinor: input.amountMinor, actionType: input.actionType } });
      await tx.insert(auditEvents).values({ workspaceId: input.workspaceId, actorUserId: input.requestedByUserId, actorMembershipId: null, action: "billing.custom_payment_request.created", entityType: "payment_request", entityId: row.id, afterJson: { humanCode: row.humanCode, actionType: input.actionType, planCode: input.targetPlanCode, amountMinor: input.amountMinor, method: input.paymentMethod } });
      return row;
    } catch (err) {
      if (isHumanCodeCollision(err) && attempt < 5) continue;
      throw err;
    }
  }
  throw new Error("Failed to allocate a unique payment-request code after several attempts.");
}

export interface CreateCustomPaymentRequestInput {
  workspaceId: string;
  requestedByUserId: string;
  acceptedOfferId: string;
  paymentMethod: "INSTAPAY" | "VODAFONE_CASH";
}

/**
 * Create the CUSTOM payment request from an ACCEPTED, IMMEDIATE offer. Determines
 * the action server-side: not ACTIVE → NEW_SUBSCRIPTION; ACTIVE → UPGRADE
 * (standard→custom or custom→custom INCREASE) priced by exact ledger proration.
 * A NEXT_RENEWAL offer applies at renewal, not here. Blocks on an in-flight
 * plan change (FUTURE_PLAN_CHANGE_EXISTS). Same-cycle only in V1.
 */
export async function createCustomPaymentRequestFromAcceptedOffer(db: Db, input: CreateCustomPaymentRequestInput): Promise<PaymentRequestRow> {
  return db.transaction(async (tx) => {
    const offer = await findCustomOfferForWorkspace(tx, input.workspaceId, input.acceptedOfferId);
    if (!offer) throw new CustomOfferNotFoundError();
    if (offer.status === "APPLIED") throw new CustomOfferAlreadyAppliedError();
    if (offer.status !== "ACCEPTED") throw new CustomOfferNotAcceptableError();
    if (offer.effectiveMode !== "IMMEDIATE") throw new CustomOfferNotAcceptableError(); // NEXT_RENEWAL applies at renewal

    const [sub] = await tx
      .select({ id: subscriptions.id, version: subscriptions.version, state: subscriptions.state, planCode: subscriptions.planCode, billingCycle: subscriptions.billingCycle, currentPriceMinor: subscriptions.currentPriceMinor, periodStart: subscriptions.periodStart, periodEnd: subscriptions.periodEnd, pendingPlanCode: subscriptions.pendingPlanCode })
      .from(subscriptions).where(eq(subscriptions.workspaceId, input.workspaceId)).limit(1);
    if (!sub) throw new PaymentRequestNotFoundError();

    const isActive = sub.state === ACTIVE_SUBSCRIPTION_STATE;
    const cycle = offer.billingCycle as BillingCycle;
    let actionType: "NEW_SUBSCRIPTION" | "UPGRADE";
    let amountMinor: number;

    if (!isActive) {
      actionType = "NEW_SUBSCRIPTION";
      amountMinor = offer.priceMinor;
    } else {
      actionType = "UPGRADE";
      if (sub.billingCycle && sub.billingCycle !== cycle) throw new CrossCycleUpgradeNotSupportedError();
      const nowMs = Date.now();
      const rows = await loadLedgerRowsForSubscription(tx, sub.id);
      if (sub.pendingPlanCode || hasFutureDifferentPlanPeriod(rows, nowMs)) throw new FuturePlanChangeExistsError();
      const proration = computeUpgradeProrationOverPeriods({ targetPlan: "CUSTOM", billingCycle: cycle, targetCatalogPriceMinor: offer.priceMinor, nowMs, periods: toProrationSlices(resolveEffectiveSegments(rows, nowMs)) });
      if (proration.kind === "NOT_SAME_CYCLE") throw new CrossCycleUpgradeNotSupportedError();
      if (proration.kind !== "DUE") throw new UpgradeProrationNonPositiveError();
      amountMinor = proration.amountDueMinor;
    }

    const quoteSnapshot = {
      kind: "CUSTOM",
      offerId: offer.id,
      offerVersion: offer.offerVersion,
      requestId: offer.customRequestId,
      currentPlanCode: sub.planCode,
      targetPlanCode: "CUSTOM",
      customMaxActiveStudents: offer.maxActiveStudents,
      customMaxTeamMembers: offer.maxTeamMembers,
      billingCycle: cycle,
      agreedPriceMinor: offer.priceMinor,
      targetPriceMinor: offer.priceMinor,
      recommendationPriceMinor: offer.recommendationPriceMinor,
      adjustmentReason: offer.adjustmentReason,
      // For CUSTOM ledger rows, plan_price_version carries the OFFER version (documented; see decision 2/23).
      planPriceVersion: offer.offerVersion,
      subscriptionVersion: sub.version,
      currentPeriodStart: sub.periodStart?.toISOString() ?? null,
      currentPeriodEnd: sub.periodEnd?.toISOString() ?? null,
      quoteTimestamp: new Date().toISOString(),
      effectiveMode: offer.effectiveMode,
    };

    return insertServerPricedRequestOnTx(tx, {
      workspaceId: input.workspaceId,
      requestedByUserId: input.requestedByUserId,
      actionType,
      targetPlanCode: "CUSTOM",
      billingCycle: cycle,
      amountMinor,
      currencyCode: "EGP",
      paymentMethod: input.paymentMethod,
      boundSubscriptionVersion: sub.version,
      quoteSnapshot,
    });
  });
}

/**
 * CUSTOM renewal payment request. KEEP_CURRENT_PRICE by default (the customer's
 * agreed snapshot); if an ACCEPTED NEXT_RENEWAL offer exists it governs the next
 * period (its price/limits/cycle), after usage revalidation. Never re-prices
 * from a fresh recommendation.
 */
/**
 * The `plan_price_version` stamped on a CUSTOM renewal period. A scheduled
 * NEXT_RENEWAL offer supplies its own offer version; a KEEP_CURRENT renewal
 * (no scheduled offer) carries the currently-governing offer version forward
 * from the subscription so the renewed CUSTOM period keeps a non-null offer
 * version rather than NULL. Pure so it is unit-tested without a live DB.
 */
export function customRenewalPlanPriceVersion(scheduledOfferVersion: number | null, subscriptionPlanPriceVersion: number | null): number | null {
  return scheduledOfferVersion ?? subscriptionPlanPriceVersion;
}

export async function createCustomRenewalPaymentRequest(db: Db, input: { workspaceId: string; requestedByUserId: string; paymentMethod: "INSTAPAY" | "VODAFONE_CASH" }): Promise<PaymentRequestRow> {
  return db.transaction(async (tx) => {
    const [sub] = await tx
      .select({ id: subscriptions.id, version: subscriptions.version, state: subscriptions.state, planCode: subscriptions.planCode, billingCycle: subscriptions.billingCycle, currentPriceMinor: subscriptions.currentPriceMinor, planPriceVersion: subscriptions.planPriceVersion, customMaxActiveStudents: subscriptions.customMaxActiveStudents, customMaxTeamMembers: subscriptions.customMaxTeamMembers, pendingPlanCode: subscriptions.pendingPlanCode, pendingBillingCycle: subscriptions.pendingBillingCycle, periodStart: subscriptions.periodStart, periodEnd: subscriptions.periodEnd })
      .from(subscriptions).where(eq(subscriptions.workspaceId, input.workspaceId)).limit(1);
    if (!sub) throw new PaymentRequestNotFoundError();
    if (sub.state !== ACTIVE_SUBSCRIPTION_STATE || sub.planCode !== "CUSTOM") throw new SubscriptionNotActiveError();

    // A scheduled CUSTOM→standard downgrade: the renewal targets the STANDARD
    // plan at its catalog price (usage revalidated), and confirm clears pending +
    // the custom limits. Takes precedence over any custom NEXT_RENEWAL offer.
    if (sub.pendingPlanCode && isStandardPlanCode(sub.pendingPlanCode)) {
      const stdCycle = (sub.pendingBillingCycle as BillingCycle) ?? (sub.billingCycle as BillingCycle);
      await assertDowngradeUsageFitsOnTx(tx, input.workspaceId, sub.pendingPlanCode);
      const price = resolveCatalogPrice(sub.pendingPlanCode, stdCycle);
      if (!price) throw new NoCatalogPriceError();
      return insertServerPricedRequestOnTx(tx, {
        workspaceId: input.workspaceId,
        requestedByUserId: input.requestedByUserId,
        actionType: "RENEWAL",
        targetPlanCode: sub.pendingPlanCode,
        billingCycle: stdCycle,
        amountMinor: price.amountMinor,
        currencyCode: price.currency,
        paymentMethod: input.paymentMethod,
        boundSubscriptionVersion: sub.version,
        quoteSnapshot: { kind: "RENEWAL", planCode: sub.pendingPlanCode, billingCycle: stdCycle, amountMinor: price.amountMinor, currency: price.currency, planPriceVersion: price.planPriceVersion, subscriptionVersion: sub.version },
      });
    }

    // Accepted NEXT_RENEWAL offer (custom→custom change scheduled for renewal), if any.
    const scheduled = await findAcceptedNextRenewalOffer(tx, input.workspaceId);

    let maxStudents = sub.customMaxActiveStudents!;
    let maxTeam = sub.customMaxTeamMembers!;
    let priceMinor = sub.currentPriceMinor!;
    let cycle = sub.billingCycle as BillingCycle;
    let offerId: string | null = null;
    let offerVersion: number | null = null;
    let recommendationPriceMinor: number | null = null;
    let adjustmentReason: string | null = null;

    if (scheduled) {
      if (scheduled.billingCycle !== sub.billingCycle) throw new CrossCycleUpgradeNotSupportedError(); // cross-cycle commercial change deferred
      // Revalidate usage against the scheduled (possibly lower) limits.
      await assertCustomUsageFitsOnTx(tx, input.workspaceId, scheduled.maxActiveStudents, scheduled.maxTeamMembers);
      maxStudents = scheduled.maxActiveStudents; maxTeam = scheduled.maxTeamMembers; priceMinor = scheduled.priceMinor; cycle = scheduled.billingCycle as BillingCycle;
      offerId = scheduled.id; offerVersion = scheduled.offerVersion; recommendationPriceMinor = scheduled.recommendationPriceMinor; adjustmentReason = scheduled.adjustmentReason;
    }

    const quoteSnapshot = {
      kind: "CUSTOM",
      offerId, offerVersion,
      currentPlanCode: "CUSTOM",
      targetPlanCode: "CUSTOM",
      customMaxActiveStudents: maxStudents,
      customMaxTeamMembers: maxTeam,
      billingCycle: cycle,
      agreedPriceMinor: priceMinor,
      targetPriceMinor: priceMinor,
      recommendationPriceMinor,
      adjustmentReason,
      planPriceVersion: customRenewalPlanPriceVersion(offerVersion, sub.planPriceVersion),
      subscriptionVersion: sub.version,
      currentPeriodEnd: sub.periodEnd?.toISOString() ?? null,
      quoteTimestamp: new Date().toISOString(),
    };

    return insertServerPricedRequestOnTx(tx, {
      workspaceId: input.workspaceId,
      requestedByUserId: input.requestedByUserId,
      actionType: "RENEWAL",
      targetPlanCode: "CUSTOM",
      billingCycle: cycle,
      amountMinor: priceMinor,
      currencyCode: "EGP",
      paymentMethod: input.paymentMethod,
      boundSubscriptionVersion: sub.version,
      quoteSnapshot,
    });
  });
}

/** The single ACCEPTED NEXT_RENEWAL custom offer for a workspace (scheduled future custom terms), if any. */
async function findAcceptedNextRenewalOffer(tx: Db, workspaceId: string) {
  const rows = await tx.select().from(customPlanOffers).where(and(eq(customPlanOffers.workspaceId, workspaceId), eq(customPlanOffers.status, "ACCEPTED"), eq(customPlanOffers.effectiveMode, "NEXT_RENEWAL"))).orderBy(desc(customPlanOffers.acceptedAt)).limit(1);
  return rows[0];
}

/** Throw DOWNGRADE_BLOCKED_BY_USAGE when current usage exceeds given CUSTOM limits (custom→custom decrease guard). */
async function assertCustomUsageFitsOnTx(tx: Db, workspaceId: string, maxStudents: number, maxTeam: number): Promise<void> {
  const currentMonthId = await findCurrentMonthId(tx, workspaceId);
  const students = currentMonthId ? await getActiveStudentCountForMonth(tx, workspaceId, currentMonthId) : 0;
  const team = await getActiveTeamUsage(tx, workspaceId);
  if (students > maxStudents || team > maxTeam) {
    throw new DowngradeBlockedByUsageError({ currentStudents: students, targetStudentLimit: maxStudents, currentTeamMembers: team, targetTeamLimit: maxTeam });
  }
}

// ---------------------------------------------------------------------------
// Confirm (platform admin, app_platform_admin) — the critical race-safe,
// idempotent transaction.
// ---------------------------------------------------------------------------

export interface ConfirmPaymentRequestInput {
  paymentRequestId: string;
  confirmedByUserId: string;
}

export async function confirmPaymentRequestTransaction(
  db: Db,
  input: ConfirmPaymentRequestInput,
): Promise<{ paymentRequest: PaymentRequestRow; payment: SubscriptionPaymentRow }> {
  return db.transaction(async (tx) => {
    // 1. Lock the request row — serialises concurrent confirms of the SAME request.
    const [request] = await tx.select().from(paymentRequests).where(eq(paymentRequests.id, input.paymentRequestId)).for("update");
    if (!request) throw new PaymentRequestNotFoundError();

    // 2/3. Idempotent replay: already confirmed → return the existing payment.
    if (request.status === "CONFIRMED") {
      const [existingPayment] = await tx.select().from(subscriptionPayments).where(eq(subscriptionPayments.paymentRequestId, request.id)).limit(1);
      if (existingPayment) return { paymentRequest: request, payment: existingPayment };
    }
    if (request.status !== "PENDING") throw new PaymentRequestNotPendingError();
    if (request.expiresAt && request.expiresAt.getTime() < Date.now()) throw new PaymentRequestExpiredError();

    // 4. Stale-quote guard: the subscription must be exactly the version quoted.
    const [subscription] = await tx
      .select({
        id: subscriptions.id,
        version: subscriptions.version,
        planCode: subscriptions.planCode,
        billingCycle: subscriptions.billingCycle,
        currentPriceMinor: subscriptions.currentPriceMinor,
        priceCurrencyCode: subscriptions.priceCurrencyCode,
        planPriceVersion: subscriptions.planPriceVersion,
        periodStart: subscriptions.periodStart,
        periodEnd: subscriptions.periodEnd,
        pendingPlanCode: subscriptions.pendingPlanCode,
      })
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, request.workspaceId))
      .limit(1);
    if (!subscription) throw new PaymentRequestNotFoundError();
    if (subscription.version !== request.boundSubscriptionVersion) throw new PaymentRequestStaleError();

    const now = new Date();
    const quote = request.quoteSnapshotJson as {
      planPriceVersion: number;
      customMaxActiveStudents?: number;
      customMaxTeamMembers?: number;
      offerId?: string;
    };
    const isCustom = request.targetPlanCode === "CUSTOM";
    const customLimits = isCustom
      ? { customMaxActiveStudents: quote.customMaxActiveStudents ?? null, customMaxTeamMembers: quote.customMaxTeamMembers ?? null }
      : { customMaxActiveStudents: null, customMaxTeamMembers: null };

    // 6. Immutable payment (UNIQUE(payment_request_id) + UNIQUE(workspace, idempotency_key) block a double-confirm).
    const [payment] = await tx
      .insert(subscriptionPayments)
      .values({
        workspaceId: request.workspaceId,
        paymentRequestId: request.id,
        amountMinor: request.amountMinor,
        currencyCode: request.currencyCode,
        method: request.paymentMethod,
        confirmationSource: "MANUAL_ADMIN",
        idempotencyKey: `confirm:${request.id}`,
        confirmedByUserId: input.confirmedByUserId,
        confirmedAt: now,
      })
      .returning();
    if (!payment) throw new Error("Failed to insert subscription_payments row.");

    // 7. Request → CONFIRMED.
    const [confirmedRequest] = await tx
      .update(paymentRequests)
      .set({ status: "CONFIRMED", resolvedByUserId: input.confirmedByUserId, resolvedAt: now, updatedAt: now, version: request.version + 1 })
      .where(eq(paymentRequests.id, request.id))
      .returning();
    if (!confirmedRequest) throw new Error("Failed to update payment_requests row to CONFIRMED.");

    // 8. Append the period(s) to the immutable ledger, then sync the aggregate
    //    from the ledger (source of truth). RENEWAL extends from paid-through;
    //    UPGRADE appends target-plan rows over the remaining time (period_end
    //    unchanged); a scheduled-downgrade renewal appends a FUTURE lower-plan
    //    period without touching the current plan.
    const nowMs = now.getTime();
    let clearPending = false;

    if (request.actionType === "UPGRADE") {
      await appendUpgradePeriodsOnTx(tx, subscription, request, nowMs, payment.id);
    } else {
      // NEW_SUBSCRIPTION / RENEWAL — append one full-cycle period. Every paid
      // subscription's FIRST activation is a NEW_SUBSCRIPTION that seeds its own
      // ledger row, so a later renewal always has a current period to resolve
      // against — no read/confirm-time backfill of invented history is needed.
      const { periodStart, periodEnd } = computeConfirmedPeriod({
        actionType: request.actionType,
        currentPeriodEnd: subscription.periodEnd,
        now,
        cycle: request.billingCycle as BillingCycle,
      });
      await appendSubscriptionPeriodOnTx(tx, {
        workspaceId: request.workspaceId,
        subscriptionId: subscription.id,
        planCode: request.targetPlanCode,
        billingCycle: request.billingCycle,
        cyclePriceMinor: request.amountMinor,
        currencyCode: request.currencyCode,
        planPriceVersion: quote.planPriceVersion,
        periodStart,
        periodEnd,
        nominalCycleStart: periodStart,
        nominalCycleEnd: periodEnd,
        sourceAction: request.actionType === "RENEWAL" ? "RENEWAL" : "NEW_SUBSCRIPTION",
        customMaxActiveStudents: customLimits.customMaxActiveStudents,
        customMaxTeamMembers: customLimits.customMaxTeamMembers,
        sourcePaymentId: payment.id,
        supersedesPeriodId: null,
      });
      clearPending = !!subscription.pendingPlanCode && request.targetPlanCode === subscription.pendingPlanCode;
    }

    // Sync the aggregate to the ledger's EFFECTIVE state at `now` + paid-through.
    const ledgerRows = await loadLedgerRowsForSubscription(tx, subscription.id);
    const effective = effectiveRowAt(ledgerRows, nowMs) ?? ledgerRows[ledgerRows.length - 1];
    if (!effective) throw new Error("No ledger period after confirm — cannot sync subscription aggregate.");
    const paidEndMs = paidThroughMs(ledgerRows) ?? effective.periodEndMs;
    const result = await applySubscriptionTransitionOnTx(tx, {
      id: subscription.id,
      workspaceId: request.workspaceId,
      expectedVersion: subscription.version,
      nextState: PAID_STATE,
      periodStart: new Date(effective.periodStartMs),
      periodEnd: new Date(paidEndMs),
      cancelAtPeriodEnd: false,
      planCode: effective.planCode,
      billingCycle: effective.billingCycle,
      currentPriceMinor: effective.cyclePriceMinor,
      priceCurrencyCode: request.currencyCode,
      planPriceVersion: effective.planPriceVersion,
      customMaxActiveStudents: effective.customMaxActiveStudents,
      customMaxTeamMembers: effective.customMaxTeamMembers,
      clearPending,
      sourceType: "ADMIN",
      sourceId: request.id,
      actorUserId: input.confirmedByUserId,
      actorMembershipId: null,
      correlationId: request.humanCode,
    });
    if (result === SUBSCRIPTION_VERSION_CONFLICT) throw new PaymentRequestStaleError();
    const periodEnd = new Date(paidEndMs);

    // CUSTOM: consume the accepted offer atomically (ACCEPTED → APPLIED + close
    // request). Exactly-once — a rollback keeps it ACCEPTED (retryable); a
    // duplicate confirm returned early above, so this runs once per offer.
    if (isCustom && quote.offerId) await markOfferAppliedOnTx(tx, quote.offerId, input.confirmedByUserId);

    // 9. Audit (payment-level) + 10. outbox + 11. notification to the customer owner.
    await tx.insert(auditEvents).values({
      workspaceId: request.workspaceId,
      actorUserId: input.confirmedByUserId,
      actorMembershipId: null,
      action: "billing.payment.confirmed",
      entityType: "payment_request",
      entityId: request.id,
      beforeJson: { status: "PENDING" },
      afterJson: { status: "CONFIRMED", paymentId: payment.id, amountMinor: payment.amountMinor, planCode: request.targetPlanCode, billingCycle: request.billingCycle, periodEnd: periodEnd.toISOString() },
      correlationId: request.humanCode,
    });
    await tx.insert(outboxEvents).values({
      workspaceId: request.workspaceId,
      eventType: "PaymentConfirmed",
      aggregateType: "PaymentRequest",
      aggregateId: request.id,
      payload: { paymentRequestId: request.id, paymentId: payment.id, planCode: request.targetPlanCode },
    });
    await insertBillingNotification(tx, {
      workspaceId: request.workspaceId,
      userId: request.requestedByUserId,
      type: "PAYMENT_CONFIRMED",
      title: "تم تفعيل اشتراكك",
      body: `تم تأكيد الدفع وتفعيل باقة راصد (كود ${request.humanCode}).`,
      entityId: request.id,
    });

    return { paymentRequest: confirmedRequest, payment };
  });
}

interface ConfirmSubscription {
  id: string;
  planCode: string | null;
  billingCycle: string | null;
  currentPriceMinor: number | null;
  priceCurrencyCode: string | null;
  planPriceVersion: number | null;
  periodStart: Date | null;
  periodEnd: Date | null;
}

/**
 * Append the UPGRADE period rows: for each EFFECTIVE remaining segment from
 * `now`, a target-plan row [max(now, segStart), segEnd] winning by higher seq.
 * The originals are never mutated; `period_end` (paid-through) is unchanged.
 * The current period always exists (seeded at NEW_SUBSCRIPTION), and the create
 * path already rejected a mixed future plan (FUTURE_PLAN_CHANGE_EXISTS), so all
 * remaining segments here are the same plan being upgraded.
 */
async function appendUpgradePeriodsOnTx(
  tx: Db,
  sub: ConfirmSubscription & { pendingPlanCode?: string | null },
  request: PaymentRequestRow,
  nowMs: number,
  paymentId: string,
): Promise<void> {
  const snapshot = request.quoteSnapshotJson as { targetPriceMinor?: number; planPriceVersion?: number; customMaxActiveStudents?: number; customMaxTeamMembers?: number };
  const targetPriceMinor = snapshot.targetPriceMinor ?? request.amountMinor;
  const isCustom = request.targetPlanCode === "CUSTOM";
  const rows = await loadLedgerRowsForSubscription(tx, sub.id);
  const segments = resolveEffectiveSegments(rows, nowMs).filter((s) => s.endMs > nowMs);
  const workspaceId = request.workspaceId;
  for (const seg of segments) {
    await appendSubscriptionPeriodOnTx(tx, {
      workspaceId,
      subscriptionId: sub.id,
      planCode: request.targetPlanCode,
      billingCycle: request.billingCycle,
      cyclePriceMinor: targetPriceMinor,
      currencyCode: request.currencyCode,
      planPriceVersion: snapshot.planPriceVersion ?? null,
      customMaxActiveStudents: isCustom ? snapshot.customMaxActiveStudents ?? null : null,
      customMaxTeamMembers: isCustom ? snapshot.customMaxTeamMembers ?? null : null,
      periodStart: new Date(Math.max(nowMs, seg.startMs)),
      periodEnd: new Date(seg.endMs),
      nominalCycleStart: new Date(seg.nominalCycleStartMs),
      nominalCycleEnd: new Date(seg.nominalCycleEndMs),
      sourceAction: "UPGRADE",
      sourcePaymentId: paymentId,
      supersedesPeriodId: seg.sourceRowId,
    });
  }
}

/** Throw DOWNGRADE_BLOCKED_BY_USAGE when current usage exceeds the target plan's limits. */
async function assertDowngradeUsageFitsOnTx(tx: Db, workspaceId: string, targetPlan: string): Promise<void> {
  if (!isStandardPlanCode(targetPlan)) throw new NotADowngradeError();
  const currentMonthId = await findCurrentMonthId(tx, workspaceId);
  const currentActiveStudents = currentMonthId ? await getActiveStudentCountForMonth(tx, workspaceId, currentMonthId) : 0;
  const currentActiveTeamMembers = await getActiveTeamUsage(tx, workspaceId);
  const decision = evaluateDowngradeUsage({ targetPlan, currentActiveStudents, currentActiveTeamMembers });
  if (decision.decision === "BLOCKED_BY_USAGE") {
    throw new DowngradeBlockedByUsageError({
      currentStudents: decision.currentStudents,
      targetStudentLimit: decision.targetStudentLimit,
      currentTeamMembers: decision.currentTeamMembers,
      targetTeamLimit: decision.targetTeamLimit,
    });
  }
}

// ---------------------------------------------------------------------------
// Scheduled downgrade (customer owner, app_runtime) — a FUTURE-renewal target
// only; the current plan never changes. Validates usage fits the target now,
// stores the pending state (one max), and audits. No payment involved.
// ---------------------------------------------------------------------------

export interface ScheduleDowngradeInput {
  workspaceId: string;
  requestedByUserId: string;
  targetPlanCode: StandardPlanCode;
}

export async function scheduleDowngradeTransaction(db: Db, input: ScheduleDowngradeInput): Promise<SubscriptionRow> {
  return db.transaction(async (tx) => {
    const [sub] = await tx
      .select({ id: subscriptions.id, version: subscriptions.version, state: subscriptions.state, planCode: subscriptions.planCode, billingCycle: subscriptions.billingCycle })
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, input.workspaceId))
      .limit(1);
    if (!sub) throw new PaymentRequestNotFoundError();
    if (sub.state !== ACTIVE_SUBSCRIPTION_STATE) throw new SubscriptionNotActiveError();
    if (!isStandardPlanCode(input.targetPlanCode)) throw new NotADowngradeError();
    if (sub.planCode === "CUSTOM") {
      // CUSTOM → standard: always a downgrade (CUSTOM sits above every standard
      // plan). Only usage vs the target standard limits gates it.
    } else {
      if (!sub.planCode || !isStandardPlanCode(sub.planCode)) throw new PlanChangeNotSupportedError();
      assertDowngradeTransition(sub.planCode, input.targetPlanCode); // throws NOT_A_DOWNGRADE / SAME_PLAN / …
    }
    await assertDowngradeUsageFitsOnTx(tx, input.workspaceId, input.targetPlanCode);

    const now = new Date();
    const [updated] = await tx
      .update(subscriptions)
      .set({
        pendingPlanCode: input.targetPlanCode,
        pendingBillingCycle: sub.billingCycle, // V1: downgrade keeps the current cycle
        pendingChangeRequestedAt: now,
        pendingChangeRequestedBy: input.requestedByUserId,
        updatedAt: now,
        version: sub.version + 1,
      })
      .where(and(eq(subscriptions.id, sub.id), eq(subscriptions.version, sub.version)))
      .returning();
    if (!updated) throw new PaymentRequestStaleError();

    await tx.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.requestedByUserId,
      actorMembershipId: null,
      action: "billing.downgrade.scheduled",
      entityType: "subscription",
      entityId: sub.id,
      beforeJson: { planCode: sub.planCode },
      afterJson: { pendingPlanCode: input.targetPlanCode, effective: "NEXT_RENEWAL" },
    });
    return updated;
  });
}

export async function cancelScheduledDowngradeTransaction(
  db: Db,
  input: { workspaceId: string; actorUserId: string },
): Promise<SubscriptionRow> {
  return db.transaction(async (tx) => {
    const [sub] = await tx
      .select({ id: subscriptions.id, version: subscriptions.version, pendingPlanCode: subscriptions.pendingPlanCode })
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, input.workspaceId))
      .limit(1);
    if (!sub) throw new PaymentRequestNotFoundError();
    if (!sub.pendingPlanCode) throw new NoPendingDowngradeError();

    const now = new Date();
    const [updated] = await tx
      .update(subscriptions)
      .set({
        pendingPlanCode: null,
        pendingBillingCycle: null,
        pendingChangeRequestedAt: null,
        pendingChangeRequestedBy: null,
        updatedAt: now,
        version: sub.version + 1,
      })
      .where(and(eq(subscriptions.id, sub.id), eq(subscriptions.version, sub.version)))
      .returning();
    if (!updated) throw new PaymentRequestStaleError();

    await tx.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      actorMembershipId: null,
      action: "billing.downgrade.cancelled",
      entityType: "subscription",
      entityId: sub.id,
      beforeJson: { pendingPlanCode: sub.pendingPlanCode },
      afterJson: { pendingPlanCode: null },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Read-only views for the customer billing page (owner, app_runtime).
// ---------------------------------------------------------------------------

export interface BillingPlanState {
  state: SubscriptionStateDto;
  currentPlanCode: string | null;
  billingCycle: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  currentPriceMinor: number | null;
  currencyCode: string | null;
  trialDaysRemaining: number | null;
  limits: { maxActiveStudents: number; maxTeamMembers: number };
  usage: { activeStudents: number; activeTeamMembers: number };
  capacityBand: 90 | 95 | 100 | null;
  hasFuturePaidPeriod: boolean;
  pendingDowngrade: { targetPlanCode: string; billingCycle: string } | null;
}

const MS_PER_DAY_PLANSTATE = 24 * 60 * 60 * 1000;

/** Current commercial state + usage the billing page renders. Read-only. Phase 6: enriched with price snapshot, trial-days, near-capacity band, and the future-paid flag. */
export async function loadBillingPlanState(db: Db, workspaceId: string, now: Date = new Date()): Promise<BillingPlanState | null> {
  const [sub] = await db
    .select({
      id: subscriptions.id,
      state: subscriptions.state,
      planCode: subscriptions.planCode,
      billingCycle: subscriptions.billingCycle,
      periodStart: subscriptions.periodStart,
      periodEnd: subscriptions.periodEnd,
      currentPriceMinor: subscriptions.currentPriceMinor,
      priceCurrencyCode: subscriptions.priceCurrencyCode,
      customMaxActiveStudents: subscriptions.customMaxActiveStudents,
      customMaxTeamMembers: subscriptions.customMaxTeamMembers,
      pendingPlanCode: subscriptions.pendingPlanCode,
      pendingBillingCycle: subscriptions.pendingBillingCycle,
    })
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, workspaceId))
    .limit(1);
  if (!sub) return null;

  let limits = { maxActiveStudents: 0, maxTeamMembers: 0 };
  try {
    limits = resolvePlanLimits({
      subscriptionState: sub.state as SubscriptionStateDto,
      planCode: (sub.planCode as PlanCode | null) ?? null,
      customMaxActiveStudents: sub.customMaxActiveStudents,
      customMaxTeamMembers: sub.customMaxTeamMembers,
    });
  } catch {
    /* unmapped/legacy — display zeros rather than fabricate an allowance */
  }

  const currentMonthId = await findCurrentMonthId(db, workspaceId);
  const activeStudents = currentMonthId ? await getActiveStudentCountForMonth(db, workspaceId, currentMonthId) : 0;
  const activeTeamMembers = await getActiveTeamUsage(db, workspaceId);

  // Highest crossed capacity band across students + team.
  const studentBand = resolveCapacityThresholdBand(activeStudents, limits.maxActiveStudents);
  const teamBand = resolveCapacityThresholdBand(activeTeamMembers, limits.maxTeamMembers);
  const capacityBand = [studentBand, teamBand].reduce<90 | 95 | 100 | null>((best, b) => (b !== null && (best === null || b > best) ? b : best), null);

  // A future paid period already covers beyond period_end (prepaid renewal / future plan).
  const nowMs = now.getTime();
  const ledgerRows = await loadLedgerRowsForSubscription(db, sub.id);
  const hasFuturePaidPeriod = ledgerRows.some((r) => r.periodStartMs > nowMs);

  const trialDaysRemaining =
    sub.state === "TRIAL" && sub.periodEnd ? Math.max(0, Math.ceil((sub.periodEnd.getTime() - nowMs) / MS_PER_DAY_PLANSTATE)) : null;

  return {
    state: sub.state as SubscriptionStateDto,
    currentPlanCode: sub.planCode,
    billingCycle: sub.billingCycle,
    periodStart: sub.periodStart ? sub.periodStart.toISOString() : null,
    periodEnd: sub.periodEnd ? sub.periodEnd.toISOString() : null,
    currentPriceMinor: sub.currentPriceMinor ?? null,
    currencyCode: sub.priceCurrencyCode ?? null,
    trialDaysRemaining,
    limits,
    usage: { activeStudents, activeTeamMembers },
    capacityBand,
    hasFuturePaidPeriod,
    pendingDowngrade: sub.pendingPlanCode && sub.pendingBillingCycle ? { targetPlanCode: sub.pendingPlanCode, billingCycle: sub.pendingBillingCycle } : null,
  };
}

export interface UpgradeQuote {
  eligible: boolean;
  reason: string | null;
  currentPlanCode: string | null;
  targetPlanCode: StandardPlanCode;
  billingCycle: BillingCycle;
  normalTargetPriceMinor: number;
  creditRemainingMinor: number;
  amountDueMinor: number;
  currencyCode: string;
  paidThrough: string | null;
}

/** Read-only upgrade proration preview (no writes). Same math as the create path. */
export async function quoteUpgradeForWorkspace(
  db: Db,
  input: { workspaceId: string; targetPlanCode: StandardPlanCode; billingCycle: BillingCycle },
): Promise<UpgradeQuote> {
  const [sub] = await db
    .select({
      id: subscriptions.id,
      version: subscriptions.version,
      state: subscriptions.state,
      planCode: subscriptions.planCode,
      billingCycle: subscriptions.billingCycle,
      currentPriceMinor: subscriptions.currentPriceMinor,
      periodStart: subscriptions.periodStart,
      periodEnd: subscriptions.periodEnd,
      pendingPlanCode: subscriptions.pendingPlanCode,
      pendingBillingCycle: subscriptions.pendingBillingCycle,
    })
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, input.workspaceId))
    .limit(1);

  const target = resolveCatalogPrice(input.targetPlanCode, input.billingCycle);
  const base: UpgradeQuote = {
    eligible: false,
    reason: null,
    currentPlanCode: sub?.planCode ?? null,
    targetPlanCode: input.targetPlanCode,
    billingCycle: input.billingCycle,
    normalTargetPriceMinor: target?.amountMinor ?? 0,
    creditRemainingMinor: 0,
    amountDueMinor: 0,
    currencyCode: target?.currency ?? "EGP",
    paidThrough: sub?.periodEnd ? sub.periodEnd.toISOString() : null,
  };
  if (input.billingCycle !== "MONTHLY") return { ...base, reason: "ANNUAL_BILLING_NOT_SUPPORTED" }; // V1 MONTHLY-only
  if (!sub) return { ...base, reason: "SUBSCRIPTION_NOT_ACTIVE" };
  if (sub.state !== ACTIVE_SUBSCRIPTION_STATE) return { ...base, reason: "SUBSCRIPTION_NOT_ACTIVE" };
  const current = sub.planCode;
  if (!current || !isStandardPlanCode(current)) return { ...base, reason: "PLAN_CHANGE_NOT_SUPPORTED" };
  if (current === input.targetPlanCode) return { ...base, reason: "SAME_PLAN" };
  if (!isUpgrade(current, input.targetPlanCode)) return { ...base, reason: "NOT_AN_UPGRADE" };
  if (sub.billingCycle && sub.billingCycle !== input.billingCycle) return { ...base, reason: "CROSS_CYCLE_UPGRADE_NOT_SUPPORTED" };
  if (!target) return { ...base, reason: "NO_CATALOG_PRICE" };

  const nowMs = Date.now();
  const rows = await loadLedgerRowsForSubscription(db, sub.id);
  if (sub.pendingPlanCode || hasFutureDifferentPlanPeriod(rows, nowMs)) return { ...base, reason: "FUTURE_PLAN_CHANGE_EXISTS" };
  const slices = toProrationSlices(resolveEffectiveSegments(rows, nowMs));
  const proration = computeUpgradeProrationOverPeriods({
    targetPlan: input.targetPlanCode,
    billingCycle: input.billingCycle,
    targetCatalogPriceMinor: target.amountMinor,
    nowMs,
    periods: slices,
  });
  if (proration.kind === "NOT_SAME_CYCLE") return { ...base, reason: "CROSS_CYCLE_UPGRADE_NOT_SUPPORTED" };
  if (proration.kind !== "DUE") return { ...base, reason: "UPGRADE_PRORATION_NON_POSITIVE" };
  return {
    ...base,
    eligible: true,
    creditRemainingMinor: proration.creditRemainingMinor,
    amountDueMinor: proration.amountDueMinor,
  };
}

// ---------------------------------------------------------------------------
// Reject (platform admin) — reason mandatory, no payment, no subscription change.
// ---------------------------------------------------------------------------

export async function rejectPaymentRequestTransaction(
  db: Db,
  input: { paymentRequestId: string; rejectedByUserId: string; reason: string },
): Promise<PaymentRequestRow> {
  return db.transaction(async (tx) => {
    const [request] = await tx.select().from(paymentRequests).where(eq(paymentRequests.id, input.paymentRequestId)).for("update");
    if (!request) throw new PaymentRequestNotFoundError();
    if (request.status === "REJECTED") return request; // idempotent
    if (request.status !== "PENDING") throw new PaymentRequestNotPendingError();

    const now = new Date();
    const [rejected] = await tx
      .update(paymentRequests)
      .set({ status: "REJECTED", rejectReason: input.reason, resolvedByUserId: input.rejectedByUserId, resolvedAt: now, updatedAt: now, version: request.version + 1 })
      .where(eq(paymentRequests.id, request.id))
      .returning();
    if (!rejected) throw new Error("Failed to update payment_requests row to REJECTED.");

    await tx.insert(auditEvents).values({
      workspaceId: request.workspaceId,
      actorUserId: input.rejectedByUserId,
      actorMembershipId: null,
      action: "billing.payment.rejected",
      entityType: "payment_request",
      entityId: request.id,
      beforeJson: { status: "PENDING" },
      afterJson: { status: "REJECTED" },
      reason: input.reason,
      correlationId: request.humanCode,
    });
    await tx.insert(outboxEvents).values({
      workspaceId: request.workspaceId,
      eventType: "PaymentRejected",
      aggregateType: "PaymentRequest",
      aggregateId: request.id,
      payload: { paymentRequestId: request.id },
    });
    await insertBillingNotification(tx, {
      workspaceId: request.workspaceId,
      userId: request.requestedByUserId,
      type: "PAYMENT_REJECTED",
      title: "لم يتم تأكيد الدفع",
      body: `لم نتمكن من تأكيد دفعتك (كود ${request.humanCode}). السبب: ${input.reason}`,
      entityId: request.id,
    });
    return rejected;
  });
}

// ---------------------------------------------------------------------------
// Reversal (platform admin) — append a correction row; the original payment is
// NEVER modified and there is NO automatic subscription rollback (Phase 3).
// ---------------------------------------------------------------------------

export async function reverseSubscriptionPaymentTransaction(
  db: Db,
  input: { paymentId: string; reversedByUserId: string; reason: string },
): Promise<typeof subscriptionPaymentReversals.$inferSelect> {
  return db.transaction(async (tx) => {
    const [payment] = await tx.select().from(subscriptionPayments).where(eq(subscriptionPayments.id, input.paymentId)).for("update");
    if (!payment) throw new PaymentRequestNotFoundError();
    const [reversal] = await tx
      .insert(subscriptionPaymentReversals)
      .values({ workspaceId: payment.workspaceId, paymentId: payment.id, reason: input.reason, reversedByUserId: input.reversedByUserId })
      .returning();
    if (!reversal) throw new Error("Failed to insert subscription_payment_reversals row.");
    await tx.insert(auditEvents).values({
      workspaceId: payment.workspaceId,
      actorUserId: input.reversedByUserId,
      actorMembershipId: null,
      action: "billing.payment.reversed",
      entityType: "subscription_payment",
      entityId: payment.id,
      afterJson: { reversalId: reversal.id },
      reason: input.reason,
    });
    return reversal;
  });
}

/** Direct notification insert (dedup via the unique index → ON CONFLICT DO NOTHING). */
async function insertBillingNotification(
  tx: Db,
  input: { workspaceId: string; userId: string; type: string; title: string; body: string; entityId: string },
): Promise<void> {
  await tx
    .insert(notifications)
    .values({
      workspaceId: input.workspaceId,
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      entityType: "payment_request",
      entityId: input.entityId,
      dedupKey: `${input.type}:${input.entityId}`,
    })
    .onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// Reads.
// ---------------------------------------------------------------------------

export function listPaymentRequestsForWorkspace(db: Db, workspaceId: string, limit = 20): Promise<PaymentRequestRow[]> {
  return db
    .select()
    .from(paymentRequests)
    .where(eq(paymentRequests.workspaceId, workspaceId))
    .orderBy(desc(paymentRequests.createdAt))
    .limit(limit);
}

export interface PlatformPaymentRequestListRow extends PaymentRequestRow {
  workspaceName: string | null;
  customerName: string | null;
  customerPhone: string | null;
}

export async function listPlatformPaymentRequests(
  db: Db,
  params: { status?: string; cursor?: { createdAt: string; id: string }; limit: number },
): Promise<{ items: PlatformPaymentRequestListRow[]; nextCursor: { createdAt: string; id: string } | null; hasNext: boolean }> {
  const conditions = [];
  if (params.status) conditions.push(eq(paymentRequests.status, params.status));
  if (params.cursor) {
    // Keyset pagination on (created_at DESC, id DESC).
    conditions.push(
      or(
        lt(paymentRequests.createdAt, new Date(params.cursor.createdAt)),
        and(eq(paymentRequests.createdAt, new Date(params.cursor.createdAt)), lt(paymentRequests.id, params.cursor.id)),
      ),
    );
  }
  const rows = await db
    .select({
      request: paymentRequests,
      workspaceName: workspaces.name,
      customerName: users.fullName,
      customerPhone: users.phone,
    })
    .from(paymentRequests)
    .leftJoin(workspaces, eq(workspaces.id, paymentRequests.workspaceId))
    .leftJoin(users, eq(users.id, paymentRequests.requestedByUserId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(paymentRequests.createdAt), desc(paymentRequests.id))
    .limit(params.limit + 1);

  const hasNext = rows.length > params.limit;
  const page = hasNext ? rows.slice(0, params.limit) : rows;
  const items: PlatformPaymentRequestListRow[] = page.map((r) => ({ ...r.request, workspaceName: r.workspaceName, customerName: r.customerName, customerPhone: r.customerPhone }));
  const last = page[page.length - 1];
  const nextCursor = hasNext && last ? { createdAt: last.request.createdAt.toISOString(), id: last.request.id } : null;
  return { items, nextCursor, hasNext };
}

export function findPlatformPaymentRequestById(db: Db, id: string): Promise<PlatformPaymentRequestListRow | undefined> {
  return db
    .select({ request: paymentRequests, workspaceName: workspaces.name, customerName: users.fullName, customerPhone: users.phone })
    .from(paymentRequests)
    .leftJoin(workspaces, eq(workspaces.id, paymentRequests.workspaceId))
    .leftJoin(users, eq(users.id, paymentRequests.requestedByUserId))
    .where(eq(paymentRequests.id, id))
    .limit(1)
    .then((rows) => (rows[0] ? { ...rows[0].request, workspaceName: rows[0].workspaceName, customerName: rows[0].customerName, customerPhone: rows[0].customerPhone } : undefined));
}
