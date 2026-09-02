/**
 * Billing history read model — Billing Engine, Phase 6. Read-only, additive: a
 * unified, customer-safe timeline composed over the existing append-only tables
 * (`subscription_payments`, `subscription_payment_reversals`, `payment_requests`,
 * `custom_plan_offers`). No new table, no destructive change. Runs on
 * `app_runtime` (workspace-scoped by RLS). NEVER exposes raw audit JSON or
 * internal admin notes — only human-readable Arabic summaries + customer-safe
 * references (the RSD human code, the plan, the amount).
 *
 * Billing events per workspace are inherently few, so each source is read within
 * a bounded window and merged/sorted/paginated in memory with an opaque cursor
 * (the occurred-at epoch ms of the last returned item).
 */
import { and, desc, eq, lt } from "drizzle-orm";
import type { BillingHistoryEventType } from "@academic-precision/contracts";
import { formatEgpMinor } from "@academic-precision/contracts";
import type { Db } from "./identity.repository";
import { subscriptionPayments, subscriptionPaymentReversals } from "../schema/subscription-payments";
import { paymentRequests } from "../schema/payment-requests";
import { customPlanOffers } from "../schema/custom-plans";

export interface BillingHistoryItemRow {
  type: BillingHistoryEventType;
  occurredAt: string;
  title: string;
  planCode: string | null;
  amountMinor: number | null;
  currencyCode: string | null;
  reference: string | null;
}

export interface BillingHistoryPage {
  items: BillingHistoryItemRow[];
  page: { nextCursor: string | null; hasNext: boolean };
}

const SOURCE_WINDOW = 200; // per-source cap; billing events per workspace are few

function planTitle(actionType: string): { type: BillingHistoryEventType; label: string } {
  if (actionType === "UPGRADE") return { type: "PLAN_UPGRADED", label: "ترقية الباقة" };
  if (actionType === "RENEWAL") return { type: "RENEWAL", label: "تجديد الاشتراك" };
  return { type: "PAYMENT_CONFIRMED", label: "تأكيد الدفع" };
}

/** The unified billing timeline for a workspace, newest first, cursor-paginated. */
export async function loadBillingHistory(
  db: Db,
  input: { workspaceId: string; cursor?: string | null; limit?: number },
): Promise<BillingHistoryPage> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const cursorMs = input.cursor ? Number(input.cursor) : null;
  const cutoff = cursorMs !== null && Number.isFinite(cursorMs) ? new Date(cursorMs) : null;

  const events: BillingHistoryItemRow[] = [];

  // 1. Confirmed payments (join the request for the plan + human code + nature).
  const payWhere = [eq(subscriptionPayments.workspaceId, input.workspaceId)];
  if (cutoff) payWhere.push(lt(subscriptionPayments.confirmedAt, cutoff));
  const payments = await db
    .select({
      confirmedAt: subscriptionPayments.confirmedAt,
      amountMinor: subscriptionPayments.amountMinor,
      currencyCode: subscriptionPayments.currencyCode,
      humanCode: paymentRequests.humanCode,
      targetPlanCode: paymentRequests.targetPlanCode,
      actionType: paymentRequests.actionType,
    })
    .from(subscriptionPayments)
    .innerJoin(paymentRequests, eq(paymentRequests.id, subscriptionPayments.paymentRequestId))
    .where(and(...payWhere))
    .orderBy(desc(subscriptionPayments.confirmedAt))
    .limit(SOURCE_WINDOW);
  for (const p of payments) {
    const kind = planTitle(p.actionType);
    events.push({ type: kind.type, occurredAt: p.confirmedAt.toISOString(), title: kind.label, planCode: p.targetPlanCode, amountMinor: Number(p.amountMinor), currencyCode: p.currencyCode, reference: p.humanCode });
  }

  // 2. Reversals.
  const revWhere = [eq(subscriptionPaymentReversals.workspaceId, input.workspaceId)];
  if (cutoff) revWhere.push(lt(subscriptionPaymentReversals.reversedAt, cutoff));
  const reversals = await db
    .select({ reversedAt: subscriptionPaymentReversals.reversedAt })
    .from(subscriptionPaymentReversals)
    .where(and(...revWhere))
    .orderBy(desc(subscriptionPaymentReversals.reversedAt))
    .limit(SOURCE_WINDOW);
  for (const r of reversals) {
    events.push({ type: "PAYMENT_REVERSED", occurredAt: r.reversedAt.toISOString(), title: "تم عكس الدفعة", planCode: null, amountMinor: null, currencyCode: null, reference: null });
  }

  // 3. Payment requests — created (all) + rejected.
  const reqWhere = [eq(paymentRequests.workspaceId, input.workspaceId)];
  if (cutoff) reqWhere.push(lt(paymentRequests.createdAt, cutoff));
  const requests = await db
    .select({ createdAt: paymentRequests.createdAt, humanCode: paymentRequests.humanCode, targetPlanCode: paymentRequests.targetPlanCode, amountMinor: paymentRequests.amountMinor, currencyCode: paymentRequests.currencyCode, status: paymentRequests.status })
    .from(paymentRequests)
    .where(and(...reqWhere))
    .orderBy(desc(paymentRequests.createdAt))
    .limit(SOURCE_WINDOW);
  for (const r of requests) {
    events.push({ type: "PAYMENT_REQUEST_CREATED", occurredAt: r.createdAt.toISOString(), title: `طلب دفع (${formatEgpMinor(Number(r.amountMinor))})`, planCode: r.targetPlanCode, amountMinor: Number(r.amountMinor), currencyCode: r.currencyCode, reference: r.humanCode });
    if (r.status === "REJECTED") {
      events.push({ type: "PAYMENT_REJECTED", occurredAt: r.createdAt.toISOString(), title: "تم رفض طلب الدفع", planCode: r.targetPlanCode, amountMinor: null, currencyCode: null, reference: r.humanCode });
    }
  }

  // 4. Custom offers — accepted + applied.
  const offWhere = [eq(customPlanOffers.workspaceId, input.workspaceId)];
  const offers = await db
    .select({ acceptedAt: customPlanOffers.acceptedAt, status: customPlanOffers.status, priceMinor: customPlanOffers.priceMinor, currencyCode: customPlanOffers.currencyCode })
    .from(customPlanOffers)
    .where(and(...offWhere))
    .orderBy(desc(customPlanOffers.acceptedAt))
    .limit(SOURCE_WINDOW);
  for (const o of offers) {
    if (!o.acceptedAt) continue;
    const isCutoffPast = cutoff ? o.acceptedAt.getTime() < cutoff.getTime() : true;
    if (!isCutoffPast) continue;
    if (o.status === "ACCEPTED" || o.status === "APPLIED") {
      events.push({ type: "CUSTOM_OFFER_ACCEPTED", occurredAt: o.acceptedAt.toISOString(), title: "قبول عرض الباقة المخصّصة", planCode: "CUSTOM", amountMinor: Number(o.priceMinor), currencyCode: o.currencyCode, reference: null });
    }
    if (o.status === "APPLIED") {
      events.push({ type: "CUSTOM_APPLIED", occurredAt: o.acceptedAt.toISOString(), title: "تفعيل الباقة المخصّصة", planCode: "CUSTOM", amountMinor: Number(o.priceMinor), currencyCode: o.currencyCode, reference: null });
    }
  }

  // Merge → newest first → page.
  events.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  const pageItems = events.slice(0, limit);
  const hasNext = events.length > limit;
  const nextCursor = hasNext && pageItems.length > 0 ? String(new Date(pageItems[pageItems.length - 1]!.occurredAt).getTime()) : null;
  return { items: pageItems, page: { nextCursor, hasNext } };
}
