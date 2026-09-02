/**
 * Scheduled Subscription expiry check — Billing Engine (Phase 8 origin, Phase 6
 * lifecycle closure). Runs on the `app_worker` connection, called by
 * `apps/worker`'s polling loop.
 *
 * A subscription whose paid-through / trial `period_end` has passed transitions
 * to EXPIRED (§44.2 "No Grace Period in V1"). Phase 6 extends this to
 * ACTIVE/EXPIRING: a manual customer who simply stops renewing must eventually
 * expire (there is no Paddle cancel event in the manual world), which is what
 * arms the central paid-operation block. A prepaid future period is NEVER
 * wrongly expired: candidates are already filtered on the aggregate
 * `period_end` (= ledger paid-through), and each ACTIVE/EXPIRING candidate is
 * re-checked against its ledger (`shouldExpireByLedger`) before the transition —
 * belt-and-suspenders. On a successful transition a deduped terminal
 * notification (TRIAL_EXPIRED / SUBSCRIPTION_EXPIRED) is emitted to the owner.
 *
 * Naturally idempotent: an already-EXPIRED row no longer matches the scan;
 * a stale `expectedVersion` on a race reports SUBSCRIPTION_VERSION_CONFLICT and
 * is retried next cycle; the notification insert is ON CONFLICT DO NOTHING.
 */
import { eq } from "drizzle-orm";
import { subscriptionExpiredContent, trialExpiredContent, lifecycleTerminalDedupKey } from "@academic-precision/contracts";
import { withWorkerRuntimeContext } from "../connection";
import type { Db } from "../repositories/identity.repository";
import {
  findExpirableSubscriptions,
  updateSubscriptionStateTransaction,
  SUBSCRIPTION_VERSION_CONFLICT,
} from "../repositories/subscriptions.repository";
import { loadLedgerRowsForSubscription } from "../repositories/subscription-periods.repository";
import { paidThroughMs } from "../billing/period-ledger";
import { insertDedupedNotification } from "../repositories/notifications.repository";
import { workspaces } from "../schema/workspaces";

export interface SubscriptionExpiryCheckResult {
  scanned: number;
  expired: number;
  conflicted: number;
  /** ACTIVE/EXPIRING candidates skipped because the ledger still shows a prepaid future period (defensive; should be ~0 given the aggregate invariant). */
  skippedPrepaid: number;
}

/**
 * Pure guard: may this subscription be expired now? A null ledger paid-through
 * (e.g. a TRIAL with no paid periods) means nothing is prepaid → expire. A
 * paid-through strictly after `nowMs` means a future paid period still covers
 * the workspace → do NOT expire.
 */
export function shouldExpireByLedger(input: { paidThroughMs: number | null; nowMs: number }): boolean {
  return input.paidThroughMs === null || input.paidThroughMs <= input.nowMs;
}

export async function runSubscriptionExpiryCheck(workerDb: Db, now: Date = new Date()): Promise<SubscriptionExpiryCheckResult> {
  const candidates = await findExpirableSubscriptions(workerDb, now);

  let expired = 0;
  let conflicted = 0;
  let skippedPrepaid = 0;

  for (const subscription of candidates) {
    const wasTrial = subscription.state === "TRIAL";
    const needsLedgerCheck = subscription.state === "ACTIVE" || subscription.state === "EXPIRING";

    const outcome = await withWorkerRuntimeContext({ workspaceId: subscription.workspaceId }, async (tx) => {
      // Defensive: never expire an ACTIVE/EXPIRING sub that the ledger still covers.
      if (needsLedgerCheck) {
        const rows = await loadLedgerRowsForSubscription(tx, subscription.id);
        if (!shouldExpireByLedger({ paidThroughMs: paidThroughMs(rows), nowMs: now.getTime() })) return "SKIPPED_PREPAID" as const;
      }

      const result = await updateSubscriptionStateTransaction(tx, {
        id: subscription.id,
        workspaceId: subscription.workspaceId,
        expectedVersion: subscription.version,
        nextState: "EXPIRED",
        sourceType: "SUBSCRIPTION",
        sourceId: subscription.id,
        actorUserId: null,
        actorMembershipId: null,
      });
      if (result === SUBSCRIPTION_VERSION_CONFLICT) return "CONFLICT" as const;

      // Terminal expiry notification to the owner (deduped per the period that ended).
      const [workspace] = await tx.select({ ownerUserId: workspaces.ownerUserId, name: workspaces.name }).from(workspaces).where(eq(workspaces.id, subscription.workspaceId)).limit(1);
      if (workspace && subscription.periodEnd) {
        const content = wasTrial ? trialExpiredContent(workspace.name) : subscriptionExpiredContent(workspace.name);
        await insertDedupedNotification(tx, {
          workspaceId: subscription.workspaceId,
          userId: workspace.ownerUserId,
          type: wasTrial ? "TRIAL_EXPIRED" : "SUBSCRIPTION_EXPIRED",
          title: content.title,
          body: content.body,
          entityType: "subscription",
          entityId: subscription.id,
          dedupKey: lifecycleTerminalDedupKey(subscription.periodEnd.getTime()),
        });
      }
      return "EXPIRED" as const;
    });

    if (outcome === "CONFLICT") conflicted += 1;
    else if (outcome === "SKIPPED_PREPAID") skippedPrepaid += 1;
    else expired += 1;
  }

  return { scanned: candidates.length, expired, conflicted, skippedPrepaid };
}
