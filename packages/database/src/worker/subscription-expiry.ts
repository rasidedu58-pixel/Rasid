/**
 * Scheduled Subscription expiry check — Phase 8, API Contract §16 Async
 * Jobs Contract's `SubscriptionExpiry` job ("Trigger: Scheduled check /
 * provider event; Idempotency/Result: Entitlement state authoritative.").
 * Runs on the `app_worker` connection (never `app_runtime`), called by
 * `apps/worker`'s own polling loop alongside the outbox dispatcher.
 *
 * TRIAL/CANCELLED_AT_PERIOD_END rows whose `period_end` has passed
 * transition to EXPIRED — exactly PRD §44.2's own rule ("No Grace Period
 * in V1") and "Cancelled-at-period-end = Active until period_end, then
 * Expired". Naturally idempotent: a row already transitioned to EXPIRED
 * no longer matches the scan's `state IN (...)` filter, so re-running this
 * on the next poll cycle (or concurrently from another worker process) is
 * always safe — a stale `expectedVersion` on a race simply reports
 * SUBSCRIPTION_VERSION_CONFLICT for that one row and moves on, no crash,
 * no double-expiry, picked up again on the following cycle if it still
 * qualifies.
 */
import { withWorkerRuntimeContext } from "../connection";
import type { Db } from "../repositories/identity.repository";
import {
  findExpirableSubscriptions,
  updateSubscriptionStateTransaction,
  SUBSCRIPTION_VERSION_CONFLICT,
} from "../repositories/subscriptions.repository";

export interface SubscriptionExpiryCheckResult {
  scanned: number;
  expired: number;
  conflicted: number;
}

export async function runSubscriptionExpiryCheck(workerDb: Db, now: Date = new Date()): Promise<SubscriptionExpiryCheckResult> {
  const candidates = await findExpirableSubscriptions(workerDb, now);

  let expired = 0;
  let conflicted = 0;

  for (const subscription of candidates) {
    const result = await withWorkerRuntimeContext({ workspaceId: subscription.workspaceId }, (tx) =>
      updateSubscriptionStateTransaction(tx, {
        id: subscription.id,
        workspaceId: subscription.workspaceId,
        expectedVersion: subscription.version,
        nextState: "EXPIRED",
        sourceType: "SUBSCRIPTION",
        sourceId: subscription.id,
        actorUserId: null,
        actorMembershipId: null,
      }),
    );
    if (result === SUBSCRIPTION_VERSION_CONFLICT) {
      conflicted += 1;
    } else {
      expired += 1;
    }
  }

  return { scanned: candidates.length, expired, conflicted };
}
