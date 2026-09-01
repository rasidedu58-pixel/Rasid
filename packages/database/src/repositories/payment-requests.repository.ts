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
  resolveCatalogPrice,
  type BillingCycle,
  type StandardPlanCode,
} from "@academic-precision/contracts";
import type { Db } from "./identity.repository";
import { paymentRequests } from "../schema/payment-requests";
import { subscriptionPayments, subscriptionPaymentReversals } from "../schema/subscription-payments";
import { subscriptions } from "../schema/subscriptions";
import { workspaces } from "../schema/workspaces";
import { users } from "../schema/identity";
import { auditEvents } from "../schema/audit";
import { outboxEvents } from "../schema/outbox";
import { notifications } from "../schema/notifications";
import { applySubscriptionTransitionOnTx, SUBSCRIPTION_VERSION_CONFLICT } from "./subscriptions.repository";

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
  return db.transaction(async (tx) => {
    const [subscription] = await tx
      .select({ id: subscriptions.id, version: subscriptions.version, state: subscriptions.state, planCode: subscriptions.planCode })
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, input.workspaceId))
      .limit(1);
    if (!subscription) throw new PaymentRequestNotFoundError(); // no subscription row = misprovisioned workspace

    // Phase 3 scope: NEW_SUBSCRIPTION from any non-active state; RENEWAL only on
    // the SAME active plan. A different plan while ACTIVE is upgrade/downgrade —
    // not available in Phase 3.
    const isActive = subscription.state === ACTIVE_SUBSCRIPTION_STATE;
    const actionType = isActive ? "RENEWAL" : "NEW_SUBSCRIPTION";
    if (isActive && subscription.planCode && subscription.planCode !== input.planCode) {
      throw new PlanChangeNotSupportedError();
    }

    const price = resolveCatalogPrice(input.planCode, input.billingCycle);
    if (!price) throw new NoCatalogPriceError();

    // Dedup / anti-spam: reuse an identical PENDING request; otherwise cancel any
    // existing PENDING (the partial-unique index allows only one at a time).
    const [existingPending] = await tx
      .select()
      .from(paymentRequests)
      .where(and(eq(paymentRequests.workspaceId, input.workspaceId), eq(paymentRequests.status, "PENDING")))
      .limit(1);
    if (existingPending) {
      const sameSelection =
        existingPending.targetPlanCode === input.planCode &&
        existingPending.billingCycle === input.billingCycle &&
        existingPending.paymentMethod === input.paymentMethod;
      if (sameSelection) return { paymentRequest: existingPending, reused: true };
      await tx
        .update(paymentRequests)
        .set({ status: "CANCELLED", updatedAt: new Date(), version: existingPending.version + 1 })
        .where(eq(paymentRequests.id, existingPending.id));
    }

    const quoteSnapshot = {
      planCode: input.planCode,
      billingCycle: input.billingCycle,
      amountMinor: price.amountMinor,
      currency: price.currency,
      planPriceVersion: price.planPriceVersion,
      subscriptionVersion: subscription.version,
    };
    const expiresAt = new Date(Date.now() + DEFAULT_REQUEST_TTL_MS);

    // Insert with a unique human code — retry on the (rare) collision.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        const [row] = await tx
          .insert(paymentRequests)
          .values({
            workspaceId: input.workspaceId,
            requestedByUserId: input.requestedByUserId,
            humanCode: generateHumanCode(),
            actionType,
            targetPlanCode: input.planCode,
            billingCycle: input.billingCycle,
            amountMinor: price.amountMinor,
            currencyCode: price.currency,
            paymentMethod: input.paymentMethod,
            status: "PENDING",
            boundSubscriptionVersion: subscription.version,
            quoteSnapshotJson: quoteSnapshot,
            expiresAt,
          })
          .returning();
        if (!row) throw new Error("Failed to insert payment_requests row.");

        await tx.insert(outboxEvents).values({
          workspaceId: input.workspaceId,
          eventType: "PaymentRequestCreated",
          aggregateType: "PaymentRequest",
          aggregateId: row.id,
          payload: { paymentRequestId: row.id, planCode: input.planCode, amountMinor: price.amountMinor },
        });
        await tx.insert(auditEvents).values({
          workspaceId: input.workspaceId,
          actorUserId: input.requestedByUserId,
          actorMembershipId: null,
          action: "billing.payment_request.created",
          entityType: "payment_request",
          entityId: row.id,
          afterJson: { humanCode: row.humanCode, planCode: input.planCode, billingCycle: input.billingCycle, amountMinor: price.amountMinor, method: input.paymentMethod },
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

function isHumanCodeCollision(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("payment_requests_human_code_unique");
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
      .select({ id: subscriptions.id, version: subscriptions.version, periodEnd: subscriptions.periodEnd })
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, request.workspaceId))
      .limit(1);
    if (!subscription) throw new PaymentRequestNotFoundError();
    if (subscription.version !== request.boundSubscriptionVersion) throw new PaymentRequestStaleError();

    const now = new Date();
    const quote = request.quoteSnapshotJson as { planPriceVersion: number };

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

    // 8. Activate the subscription with the commercial snapshot + period (ONE shared transition primitive).
    //    RENEWAL extends from the current paid-through date (early renewal loses no days).
    const { periodStart, periodEnd } = computeConfirmedPeriod({
      actionType: request.actionType,
      currentPeriodEnd: subscription.periodEnd,
      now,
      cycle: request.billingCycle as BillingCycle,
    });
    const result = await applySubscriptionTransitionOnTx(tx, {
      id: subscription.id,
      workspaceId: request.workspaceId,
      expectedVersion: subscription.version,
      nextState: PAID_STATE,
      periodStart,
      periodEnd,
      cancelAtPeriodEnd: false,
      planCode: request.targetPlanCode,
      billingCycle: request.billingCycle,
      currentPriceMinor: request.amountMinor,
      priceCurrencyCode: request.currencyCode,
      planPriceVersion: quote.planPriceVersion,
      sourceType: "ADMIN",
      sourceId: request.id,
      actorUserId: input.confirmedByUserId,
      actorMembershipId: null,
      correlationId: request.humanCode,
    });
    if (result === SUBSCRIPTION_VERSION_CONFLICT) throw new PaymentRequestStaleError();

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
