/**
 * Outbox-driven notifications — the two events whose notification is a direct
 * consequence of a tenant action, not of a time-based scan.
 *
 * WHY the outbox and not an insert in the originating transaction: the only
 * role permitted to INSERT into `notifications` for a tenant workspace is
 * `app_worker` (`notifications_worker_insert`, migration 0043) — `app_runtime`
 * has SELECT + UPDATE("read_at") and nothing else. Both originating
 * transactions run on `app_runtime`, so each writes an outbox event the worker
 * already drains instead, and the notification is created on the worker
 * connection where the grant exists. No new transport, no new event bus: both
 * event types already existed or were already being produced.
 *
 * Idempotency is the unique index, not a check-then-insert: every insert goes
 * through `insertDedupedNotification`'s `ON CONFLICT DO NOTHING` against
 * `notifications_dedup_unique`. A reclaimed lease, a retried event and a
 * replayed DEAD event therefore all converge on exactly one row.
 */
import { eq } from "drizzle-orm";
import {
  newPaymentProofPendingContent,
  paymentProofPendingDedupKey,
  planDisplayName,
  teamInviteAcceptedContent,
  teamInviteAcceptedDedupKey,
} from "@academic-precision/contracts";
import { paymentRequests } from "../schema/payment-requests";
import { platformAdmins } from "../schema/platform-admin";
import { workspaces } from "../schema/workspaces";
import type { Db } from "../repositories/identity.repository";
import { insertDedupedNotification } from "../repositories/notifications.repository";

/** How many notifications this handler actually created (0 = already existed — a genuine no-op). */
export type EmitResult = number;

/**
 * `TeamInvitationAccepted` → "تم انضمام عضو جديد للفريق" for whoever authorized
 * the invitation, falling back to the workspace owner if that user is gone.
 *
 * Deduped on the MEMBERSHIP id: the membership is created exactly once, in the
 * same transaction that produced this event, so a second delivery of the event
 * can never produce a second notification.
 */
export async function emitTeamInviteAcceptedNotification(
  tx: Db,
  event: { workspaceId: string; payload: unknown },
): Promise<EmitResult> {
  const payload = (event.payload ?? {}) as {
    membershipId?: string;
    recipientUserId?: string | null;
    memberName?: string | null;
  };
  if (!payload.membershipId) return 0;

  const [workspace] = await tx
    .select({ name: workspaces.name, ownerUserId: workspaces.ownerUserId })
    .from(workspaces)
    .where(eq(workspaces.id, event.workspaceId))
    .limit(1);
  if (!workspace) return 0;

  const recipientUserId = payload.recipientUserId ?? workspace.ownerUserId;
  const content = teamInviteAcceptedContent(payload.memberName ?? null, workspace.name);
  const created = await insertDedupedNotification(tx, {
    workspaceId: event.workspaceId,
    userId: recipientUserId,
    type: "TEAM_INVITE_ACCEPTED",
    title: content.title,
    body: content.body,
    entityType: "workspace_membership",
    entityId: payload.membershipId,
    dedupKey: teamInviteAcceptedDedupKey(payload.membershipId),
  });
  return created ? 1 : 0;
}

/**
 * `PaymentRequestCreated` → "طلب دفع جديد يحتاج مراجعة" for every ACTIVE
 * platform staff member.
 *
 * Creating the request does NOT activate anything — this notification exists
 * precisely because activation requires a human to look. Deduped per (staff
 * member, request), so a retried creation or a reclaimed event never produces a
 * second alert, and a request that was cancelled/expired before the worker got
 * to it produces none at all.
 */
export async function emitPaymentRequestCreatedNotification(
  tx: Db,
  event: { workspaceId: string; payload: unknown },
): Promise<EmitResult> {
  const payload = (event.payload ?? {}) as {
    paymentRequestId?: string;
    requestedByName?: string | null;
  };
  if (!payload.paymentRequestId) return 0;

  const [request] = await tx
    .select({
      id: paymentRequests.id,
      humanCode: paymentRequests.humanCode,
      amountMinor: paymentRequests.amountMinor,
      targetPlanCode: paymentRequests.targetPlanCode,
      status: paymentRequests.status,
    })
    .from(paymentRequests)
    .where(eq(paymentRequests.id, payload.paymentRequestId))
    .limit(1);
  // Gone or already resolved before the worker reached the event: nothing to
  // ask a human to review.
  if (!request || request.status !== "PENDING") return 0;

  const [workspace] = await tx.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, event.workspaceId)).limit(1);
  if (!workspace) return 0;

  const staff = await tx
    .select({ userId: platformAdmins.userId })
    .from(platformAdmins)
    .where(eq(platformAdmins.status, "ACTIVE"));
  if (staff.length === 0) return 0;

  const content = newPaymentProofPendingContent({
    humanCode: request.humanCode,
    workspaceName: workspace.name,
    requesterName: payload.requestedByName ?? null,
    planName: planDisplayName(request.targetPlanCode),
    amountMinor: request.amountMinor,
  });

  let created = 0;
  for (const member of staff) {
    const inserted = await insertDedupedNotification(tx, {
      workspaceId: event.workspaceId,
      userId: member.userId,
      type: "NEW_PAYMENT_PROOF_PENDING",
      title: content.title,
      body: content.body,
      entityType: "payment_request",
      entityId: request.id,
      dedupKey: paymentProofPendingDedupKey(request.id),
    });
    if (inserted) created += 1;
  }
  return created;
}
