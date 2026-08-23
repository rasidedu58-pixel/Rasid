/**
 * Subscriptions / Entitlements repository — Phase 8.
 *
 * Typed query helpers + transactional operations, containing no HTTP/
 * framework concerns — mirrors `attention.repository.ts`'s/
 * `finance.repository.ts`'s convention exactly. Business/authorization
 * decisions (permission checks, webhook signature verification) live in
 * apps/api's application service layer / packages/database/src/billing's
 * own pure modules, NOT here — this module only guarantees mechanical
 * transactional integrity: provisioning, state transitions, and the
 * scheduled expiry scan (the latter called by the outbox dispatcher's own
 * worker polling loop, `app_worker` role, never `app_runtime`).
 */
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { entitlements, ownerTrialGrants, subscriptions } from "../schema/subscriptions";
import { auditEvents } from "../schema/audit";
import { outboxEvents } from "../schema/outbox";
import type { Db } from "./identity.repository";
import {
  resolveEntitlementSnapshot,
  type Capability,
  type EntitlementState,
  type SubscriptionState,
} from "../billing/entitlement-matrix";
import { hashOwnerEmail } from "../billing/owner-identity";

export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type EntitlementRow = typeof entitlements.$inferSelect;
export type OwnerTrialGrantRow = typeof ownerTrialGrants.$inferSelect;

const TRIAL_DAYS = 14;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function findSubscriptionByWorkspaceId(db: Db, workspaceId: string): Promise<SubscriptionRow | undefined> {
  return db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId)).limit(1).then((r) => r[0]);
}

export function findSubscriptionById(db: Db, id: string): Promise<SubscriptionRow | undefined> {
  return db.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1).then((r) => r[0]);
}

export function findSubscriptionByProviderSubscriptionId(
  db: Db,
  providerSubscriptionId: string,
): Promise<SubscriptionRow | undefined> {
  return db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.providerSubscriptionId, providerSubscriptionId))
    .limit(1)
    .then((r) => r[0]);
}

/** The CURRENT entitlement row per capability (latest `effective_from`) — append-only table, never updated, so "current" is derived at read time rather than flagged by a column. */
export async function listCurrentEntitlementsForWorkspace(db: Db, workspaceId: string): Promise<EntitlementRow[]> {
  const rows = await db
    .select()
    .from(entitlements)
    .where(eq(entitlements.workspaceId, workspaceId))
    .orderBy(desc(entitlements.effectiveFrom));
  const seen = new Set<string>();
  const current: EntitlementRow[] = [];
  for (const row of rows) {
    if (seen.has(row.capability)) continue;
    seen.add(row.capability);
    current.push(row);
  }
  return current;
}

/** The workspace's current ALLOWED capabilities only — used by `GET /me/workspaces/:id/context`'s `entitlements` field (a caller only needs to know what it CAN do). */
export async function listAllowedEntitlementsForWorkspace(db: Db, workspaceId: string): Promise<EntitlementRow[]> {
  const current = await listCurrentEntitlementsForWorkspace(db, workspaceId);
  return current.filter((row) => row.state === "ALLOWED");
}

export async function findCurrentEntitlement(
  db: Db,
  workspaceId: string,
  capability: Capability,
): Promise<EntitlementRow | undefined> {
  const [row] = await db
    .select()
    .from(entitlements)
    .where(and(eq(entitlements.workspaceId, workspaceId), eq(entitlements.capability, capability)))
    .orderBy(desc(entitlements.effectiveFrom))
    .limit(1);
  return row;
}

// ---------------------------------------------------------------------------
// Trial provisioning — called from WITHIN identity.repository.ts's own
// `createUserWorkspaceMembership` transaction (cross-file reuse, exactly
// like Phase 6's `upsertObligationForEnrollment` inside students.repository.ts).
// ---------------------------------------------------------------------------

export interface ProvisionSubscriptionInput {
  workspaceId: string;
  ownerUserId: string;
  /** Verified Supabase identity email — `null` is treated conservatively as NOT trial-eligible (cannot verify a never-used identity without one). */
  email: string | null;
}

export interface ProvisionSubscriptionResult {
  subscription: SubscriptionRow;
  isTrial: boolean;
}

async function insertEntitlementSnapshot(
  tx: Db,
  params: { workspaceId: string; state: SubscriptionState; sourceType: "SUBSCRIPTION" | "TRIAL" | "ADMIN"; sourceId: string | null },
): Promise<void> {
  const snapshot = resolveEntitlementSnapshot(params.state);
  const capabilities = Object.keys(snapshot) as Capability[];
  await tx.insert(entitlements).values(
    capabilities.map((capability) => ({
      workspaceId: params.workspaceId,
      capability,
      state: snapshot[capability] as EntitlementState,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
    })),
  );
}

/**
 * PRD §44.2's approved policy: "one ordinary 14-day trial per workspace
 * OWNER", enforced via `owner_trial_grants` (see schema/subscriptions.ts's
 * doc comment). `email === null`, or an email that already holds a grant,
 * → NOT trial-eligible: the subscription is created already in EXPIRED
 * state (period_start=period_end=now) rather than skipped — this reuses
 * the exact same "Expired blocks operational writes, billing/renewal stay
 * open" mechanics the rest of the system already has, with no new state
 * or bypass path invented for "never had a trial".
 */
export async function provisionSubscriptionForNewWorkspaceTransaction(
  tx: Db,
  input: ProvisionSubscriptionInput,
): Promise<ProvisionSubscriptionResult> {
  let isTrial = false;

  if (input.email) {
    const emailHash = hashOwnerEmail(input.email);
    const inserted = await tx
      .insert(ownerTrialGrants)
      .values({ emailHash, firstUserId: input.ownerUserId, firstWorkspaceId: input.workspaceId })
      .onConflictDoNothing({ target: ownerTrialGrants.emailHash })
      .returning();
    isTrial = inserted.length > 0;
  }

  const now = new Date();
  const periodEnd = isTrial ? new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000) : now;
  const state: SubscriptionState = isTrial ? "TRIAL" : "EXPIRED";

  const [subscription] = await tx
    .insert(subscriptions)
    .values({
      workspaceId: input.workspaceId,
      state,
      periodStart: now,
      periodEnd,
      cancelAtPeriodEnd: false,
    })
    .returning();
  if (!subscription) throw new Error("Failed to insert subscriptions row.");

  await insertEntitlementSnapshot(tx, {
    workspaceId: input.workspaceId,
    state,
    sourceType: "TRIAL",
    sourceId: subscription.id,
  });

  await tx.insert(auditEvents).values({
    workspaceId: input.workspaceId,
    actorUserId: input.ownerUserId,
    actorMembershipId: null,
    action: isTrial ? "subscription.trial_provisioned" : "subscription.trial_unavailable",
    entityType: "subscription",
    entityId: subscription.id,
    afterJson: { state, periodStart: now.toISOString(), periodEnd: periodEnd.toISOString() },
  });

  return { subscription, isTrial };
}

// ---------------------------------------------------------------------------
// State transitions — used by BOTH the webhook processor (apps/api) and
// the scheduled expiry check (app_worker). ONE transaction: Subscription
// UPDATE (version-checked) + Entitlements snapshot INSERT + AuditEvent +
// OutboxEvent.
// ---------------------------------------------------------------------------

export interface UpdateSubscriptionStateInput {
  id: string;
  /**
   * Not read by this function's own SQL (the row's real `workspace_id` is
   * always derived from the UPDATE's own `RETURNING` clause) — present
   * purely so CALLERS (the `app_runtime`/`app_worker` adapter wrappers)
   * know which workspace to `SET LOCAL app.workspace_id` to BEFORE this
   * runs. This matters most for the webhook path: unlike a normal
   * authenticated HTTP request (which always has an ambient workspace
   * context from `PermissionGuard`), a Paddle webhook request carries NO
   * workspace header/session at all — the workspace is resolved from the
   * verified payload's own `custom_data`, and that resolved id is the
   * ONLY way the RLS-satisfying context can be set correctly.
   */
  workspaceId: string;
  expectedVersion: number;
  nextState: SubscriptionState;
  periodStart?: Date;
  periodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
  providerSubscriptionId?: string;
  providerCustomerId?: string;
  sourceType: "SUBSCRIPTION" | "TRIAL" | "ADMIN";
  sourceId: string | null;
  actorUserId: string | null;
  actorMembershipId: string | null;
  correlationId?: string | null;
}

export const SUBSCRIPTION_VERSION_CONFLICT = "SUBSCRIPTION_VERSION_CONFLICT" as const;

function outboxEventTypeFor(nextState: SubscriptionState): string {
  if (nextState === "ACTIVE") return "SubscriptionActivated";
  if (nextState === "EXPIRED") return "SubscriptionExpired";
  // DB Schema §19 names only Activated/Expired explicitly — this is a
  // documented, minimal technical extension (not a new business rule) so
  // every OTHER transition (PAYMENT_FAILED/EXPIRING/CANCELLED_AT_PERIOD_END)
  // still emits a real outbox event for future consumers, using the same
  // established "one event per meaningful domain change" convention.
  return "SubscriptionStateChanged";
}

export async function updateSubscriptionStateTransaction(
  db: Db,
  input: UpdateSubscriptionStateInput,
): Promise<SubscriptionRow | typeof SUBSCRIPTION_VERSION_CONFLICT> {
  return db.transaction(async (tx) => {
    const patch: Partial<typeof subscriptions.$inferInsert> = {
      state: input.nextState,
      updatedAt: new Date(),
      version: input.expectedVersion + 1,
    };
    if (input.periodStart !== undefined) patch.periodStart = input.periodStart;
    if (input.periodEnd !== undefined) patch.periodEnd = input.periodEnd;
    if (input.cancelAtPeriodEnd !== undefined) patch.cancelAtPeriodEnd = input.cancelAtPeriodEnd;
    if (input.providerSubscriptionId !== undefined) patch.providerSubscriptionId = input.providerSubscriptionId;
    if (input.providerCustomerId !== undefined) patch.providerCustomerId = input.providerCustomerId;

    const [updated] = await tx
      .update(subscriptions)
      .set(patch)
      .where(and(eq(subscriptions.id, input.id), eq(subscriptions.version, input.expectedVersion)))
      .returning();
    if (!updated) return SUBSCRIPTION_VERSION_CONFLICT;

    await insertEntitlementSnapshot(tx, {
      workspaceId: updated.workspaceId,
      state: input.nextState,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
    });

    await tx.insert(auditEvents).values({
      workspaceId: updated.workspaceId,
      actorUserId: input.actorUserId,
      actorMembershipId: input.actorMembershipId,
      action: "subscription.state_changed",
      entityType: "subscription",
      entityId: updated.id,
      afterJson: { state: updated.state, cancelAtPeriodEnd: updated.cancelAtPeriodEnd },
      correlationId: input.correlationId ?? null,
    });

    await tx.insert(outboxEvents).values({
      workspaceId: updated.workspaceId,
      eventType: outboxEventTypeFor(input.nextState),
      aggregateType: "Subscription",
      aggregateId: updated.id,
      payload: { subscriptionId: updated.id, state: updated.state },
    });

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Scheduled expiry check (app_worker) — TRIAL/CANCELLED_AT_PERIOD_END rows
// whose period_end has passed, per §44.2's own rule ("No Grace Period in
// V1") and the user's stated policy ("Cancelled-at-period-end = Active
// until period_end, then Expired").
// ---------------------------------------------------------------------------

/** Runs on the WORKER connection with NO workspace context set — relies on 0038's worker-only broad SELECT policy (mirrors outbox_events' own claim policy from Phase 7), since discovering which workspaces need checking is inherently cross-tenant. */
export function findExpirableSubscriptions(workerDb: Db, now: Date = new Date()): Promise<SubscriptionRow[]> {
  return workerDb
    .select()
    .from(subscriptions)
    .where(and(inArray(subscriptions.state, ["TRIAL", "CANCELLED_AT_PERIOD_END"]), lt(subscriptions.periodEnd, now)));
}
