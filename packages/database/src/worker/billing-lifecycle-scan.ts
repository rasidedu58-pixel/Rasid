/**
 * Billing lifecycle scan — Billing Engine, Phase 6 (MONTHLY-only). Runs on
 * `app_worker`, alongside the existing notifications scan. Three sub-scans:
 *
 *  1. Payment-request expiry — a PENDING request past `expires_at` is flipped to
 *     EXPIRED (the tightly-bounded worker UPDATE policy from 0070 permits ONLY
 *     PENDING→EXPIRED) and the owner is notified once; a request within 24h of
 *     expiry gets one PAYMENT_REQUEST_EXPIRING reminder. Reads also derive
 *     expiry defensively, so the UI is correct between sweeps.
 *  2. Custom-offer expiry — a PENDING_CUSTOMER offer past `valid_until` is
 *     flipped to EXPIRED; an offer within its 3d/1d window gets a reminder.
 *  3. Capacity thresholds — an active workspace crossing 90/95/100% of its
 *     student or team limit gets one notification per band per period.
 *
 * Every insert is `ON CONFLICT DO NOTHING` on the notifications dedup index, so
 * the whole scan is idempotent under concurrent/retried runs.
 */
import { and, eq, inArray } from "drizzle-orm";
import {
  capacityContent,
  capacityThresholdDedupKey,
  customOfferAcceptedPaymentPendingContent,
  customOfferExpiringContent,
  customOfferExpiringDedupKey,
  paymentRequestExpiringContent,
  paymentRequestExpiredContent,
  paymentRequestDedupKey,
  paymentRequestExpiringDedupKey,
  resolveCapacityThresholdBand,
  resolvePlanLimits,
  OFFER_REMINDER_MILESTONES,
  type PlanCode,
  type SubscriptionStateDto,
} from "@academic-precision/contracts";
import { withWorkerRuntimeContext } from "../connection";
import type { Db } from "../repositories/identity.repository";
import { paymentRequests } from "../schema/payment-requests";
import { customPlanOffers } from "../schema/custom-plans";
import { subscriptions } from "../schema/subscriptions";
import { workspaces } from "../schema/workspaces";
import { insertDedupedNotification } from "../repositories/notifications.repository";
import { findCurrentMonthId, getActiveStudentCountForMonth, getActiveTeamUsage } from "../billing/capacity";

const MS_PER_HOUR = 60 * 60 * 1000;

export interface BillingLifecycleScanResult {
  paymentExpired: number;
  paymentExpiring: number;
  offerExpired: number;
  offerExpiring: number;
  offerAcceptedPending: number;
  capacityCreated: number;
}

export async function runBillingLifecycleScan(workerDb: Db, now: Date = new Date()): Promise<BillingLifecycleScanResult> {
  const [pay, offer, accepted, cap] = await Promise.all([
    scanPaymentRequestExpiry(workerDb, now),
    scanCustomOfferExpiry(workerDb, now),
    scanAcceptedOffersAwaitingPayment(workerDb),
    scanCapacityThresholds(workerDb),
  ]);
  return { paymentExpired: pay.expired, paymentExpiring: pay.expiring, offerExpired: offer.expired, offerExpiring: offer.expiring, offerAcceptedPending: accepted.created, capacityCreated: cap.created };
}

// Accepted custom offers awaiting payment ------------------------------------
// An ACCEPTED, IMMEDIATE-mode offer that hasn't been APPLIED (paid) yet → remind
// the owner once to complete the payment. NEXT_RENEWAL offers apply at renewal
// and need no immediate payment, so they are excluded. Deduped per offer.
async function scanAcceptedOffersAwaitingPayment(workerDb: Db): Promise<{ created: number }> {
  const accepted = await workerDb
    .select()
    .from(customPlanOffers)
    .where(and(eq(customPlanOffers.status, "ACCEPTED"), eq(customPlanOffers.effectiveMode, "IMMEDIATE")));
  let created = 0;
  for (const o of accepted) {
    await withWorkerRuntimeContext({ workspaceId: o.workspaceId }, async (tx) => {
      const [ws] = await tx.select({ ownerUserId: workspaces.ownerUserId }).from(workspaces).where(eq(workspaces.id, o.workspaceId)).limit(1);
      if (!ws) return;
      const content = customOfferAcceptedPaymentPendingContent();
      const wasCreated = await insertDedupedNotification(tx, { workspaceId: o.workspaceId, userId: ws.ownerUserId, type: "CUSTOM_OFFER_ACCEPTED_PAYMENT_PENDING", title: content.title, body: content.body, entityType: "custom_plan_offer", entityId: o.id, dedupKey: `accepted:${o.id}` });
      if (wasCreated) created += 1;
    });
  }
  return { created };
}

// 1. Payment-request expiry ---------------------------------------------------
async function scanPaymentRequestExpiry(workerDb: Db, now: Date): Promise<{ expired: number; expiring: number }> {
  const pending = await workerDb.select().from(paymentRequests).where(eq(paymentRequests.status, "PENDING"));
  let expired = 0;
  let expiring = 0;
  for (const r of pending) {
    if (!r.expiresAt) continue;
    const hoursLeft = (r.expiresAt.getTime() - now.getTime()) / MS_PER_HOUR;
    await withWorkerRuntimeContext({ workspaceId: r.workspaceId }, async (tx) => {
      if (hoursLeft <= 0) {
        // Bounded flip PENDING → EXPIRED (0070 worker policy).
        await tx.update(paymentRequests).set({ status: "EXPIRED" }).where(and(eq(paymentRequests.id, r.id), eq(paymentRequests.status, "PENDING")));
        const content = paymentRequestExpiredContent(r.humanCode);
        const created = await insertDedupedNotification(tx, { workspaceId: r.workspaceId, userId: r.requestedByUserId, type: "PAYMENT_REQUEST_EXPIRED", title: content.title, body: content.body, entityType: "payment_request", entityId: r.id, dedupKey: paymentRequestDedupKey(r.id) });
        if (created) expired += 1;
      } else if (hoursLeft <= 24) {
        const content = paymentRequestExpiringContent(r.humanCode);
        const created = await insertDedupedNotification(tx, { workspaceId: r.workspaceId, userId: r.requestedByUserId, type: "PAYMENT_REQUEST_EXPIRING", title: content.title, body: content.body, entityType: "payment_request", entityId: r.id, dedupKey: paymentRequestExpiringDedupKey(r.id) });
        if (created) expiring += 1;
      }
    });
  }
  return { expired, expiring };
}

// 2. Custom-offer expiry ------------------------------------------------------
async function scanCustomOfferExpiry(workerDb: Db, now: Date): Promise<{ expired: number; expiring: number }> {
  const pending = await workerDb.select().from(customPlanOffers).where(eq(customPlanOffers.status, "PENDING_CUSTOMER"));
  let expired = 0;
  let expiring = 0;
  for (const o of pending) {
    const hoursLeft = (o.validUntil.getTime() - now.getTime()) / MS_PER_HOUR;
    await withWorkerRuntimeContext({ workspaceId: o.workspaceId }, async (tx) => {
      if (hoursLeft <= 0) {
        await tx.update(customPlanOffers).set({ status: "EXPIRED" }).where(and(eq(customPlanOffers.id, o.id), eq(customPlanOffers.status, "PENDING_CUSTOMER")));
        expired += 1;
        return;
      }
      // Emit at the closest crossed reminder milestone (3d, then 1d).
      const daysLeft = hoursLeft / 24;
      const milestone = OFFER_REMINDER_MILESTONES.filter((d) => daysLeft <= d).sort((a, b) => a - b)[0];
      if (milestone === undefined) return;
      const [ws] = await tx.select({ ownerUserId: workspaces.ownerUserId }).from(workspaces).where(eq(workspaces.id, o.workspaceId)).limit(1);
      if (!ws) return;
      const content = customOfferExpiringContent(milestone);
      const created = await insertDedupedNotification(tx, { workspaceId: o.workspaceId, userId: ws.ownerUserId, type: "CUSTOM_OFFER_EXPIRING", title: content.title, body: content.body, entityType: "custom_plan_offer", entityId: o.id, dedupKey: customOfferExpiringDedupKey(o.id, milestone) });
      if (created) expiring += 1;
    });
  }
  return { expired, expiring };
}

// 3. Capacity thresholds ------------------------------------------------------
async function scanCapacityThresholds(workerDb: Db): Promise<{ created: number }> {
  const subs = await workerDb.select().from(subscriptions).where(inArray(subscriptions.state, ["TRIAL", "ACTIVE", "EXPIRING"]));
  let created = 0;
  for (const sub of subs) {
    await withWorkerRuntimeContext({ workspaceId: sub.workspaceId }, async (tx) => {
      let limits: { maxActiveStudents: number; maxTeamMembers: number };
      try {
        limits = resolvePlanLimits({ subscriptionState: sub.state as SubscriptionStateDto, planCode: (sub.planCode as PlanCode | null) ?? null, customMaxActiveStudents: sub.customMaxActiveStudents, customMaxTeamMembers: sub.customMaxTeamMembers });
      } catch {
        return; // unmapped/legacy — no capacity signal
      }
      const monthId = await findCurrentMonthId(tx, sub.workspaceId);
      const students = monthId ? await getActiveStudentCountForMonth(tx, sub.workspaceId, monthId) : 0;
      const team = await getActiveTeamUsage(tx, sub.workspaceId);
      const [ws] = await tx.select({ ownerUserId: workspaces.ownerUserId }).from(workspaces).where(eq(workspaces.id, sub.workspaceId)).limit(1);
      if (!ws) return;

      const studentBand = resolveCapacityThresholdBand(students, limits.maxActiveStudents);
      if (studentBand !== null && monthId) {
        const content = capacityContent("STUDENTS", studentBand);
        const wasCreated = await insertDedupedNotification(tx, { workspaceId: sub.workspaceId, userId: ws.ownerUserId, type: "CAPACITY_STUDENTS", title: content.title, body: content.body, entityType: "subscription", entityId: sub.id, dedupKey: capacityThresholdDedupKey("STUDENTS", monthId, studentBand) });
        if (wasCreated) created += 1;
      }
      const teamBand = resolveCapacityThresholdBand(team, limits.maxTeamMembers);
      if (teamBand !== null) {
        const content = capacityContent("TEAM", teamBand);
        // TEAM has no per-month period; key on the current period_end epoch so a new paid period re-arms the band.
        const periodKey = sub.periodEnd ? String(sub.periodEnd.getTime()) : "current";
        const wasCreated = await insertDedupedNotification(tx, { workspaceId: sub.workspaceId, userId: ws.ownerUserId, type: "CAPACITY_TEAM", title: content.title, body: content.body, entityType: "subscription", entityId: sub.id, dedupKey: capacityThresholdDedupKey("TEAM", periodKey, teamBand) });
        if (wasCreated) created += 1;
      }
    });
  }
  return { created };
}
