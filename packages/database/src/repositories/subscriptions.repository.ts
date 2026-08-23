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
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
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

/**
 * The CURRENT entitlement row per capability. Phase 8 Closure Delta #2:
 * "current" is looked up via `effective_to IS NULL` (the OPEN row) — not
 * "latest effective_from wins" — backed by the DB-level
 * `entitlements_workspace_capability_open_unique` partial unique index
 * (migration 0040), which guarantees at most one open row per
 * (workspace, capability) exists at all.
 */
export async function listCurrentEntitlementsForWorkspace(db: Db, workspaceId: string): Promise<EntitlementRow[]> {
  return db
    .select()
    .from(entitlements)
    .where(and(eq(entitlements.workspaceId, workspaceId), isNull(entitlements.effectiveTo)));
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
    .where(
      and(
        eq(entitlements.workspaceId, workspaceId),
        eq(entitlements.capability, capability),
        isNull(entitlements.effectiveTo),
      ),
    )
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

/**
 * Phase 8 Closure Delta #2 — append+CLOSE, in one transaction:
 * 1. Close the currently-open row (`effective_to = transitionTime`) for
 *    each capability being recomputed. A brand new workspace has no open
 *    rows yet — this UPDATE simply affects 0 rows, never an error.
 * 2. Insert the new snapshot row (`effective_from = transitionTime`,
 *    `effective_to = NULL`).
 *
 * Both statements run on the SAME `tx` the caller is already inside
 * (`provisionSubscriptionForNewWorkspaceTransaction`'s workspace-creation
 * transaction, or `updateSubscriptionStateTransaction`'s own transaction) —
 * if either statement fails, or the caller's Subscription UPDATE conflicts,
 * the whole transaction rolls back and NEITHER the close nor the insert
 * commits (proven by `subscriptions-billing-security.integration.test.ts`).
 * `transitionTime` is passed in by the caller (not read via `now()` here)
 * so the closed row's `effective_to` and the new row's `effective_from`
 * are the EXACT same instant — no gap, no overlap.
 */
async function recomputeEntitlementSnapshot(
  tx: Db,
  params: {
    workspaceId: string;
    state: SubscriptionState;
    sourceType: "SUBSCRIPTION" | "TRIAL" | "ADMIN";
    sourceId: string | null;
    transitionTime: Date;
  },
): Promise<void> {
  const snapshot = resolveEntitlementSnapshot(params.state);
  const capabilities = Object.keys(snapshot) as Capability[];

  await tx
    .update(entitlements)
    .set({ effectiveTo: params.transitionTime, updatedAt: params.transitionTime })
    .where(
      and(
        eq(entitlements.workspaceId, params.workspaceId),
        inArray(entitlements.capability, capabilities),
        isNull(entitlements.effectiveTo),
      ),
    );

  await tx.insert(entitlements).values(
    capabilities.map((capability) => ({
      workspaceId: params.workspaceId,
      capability,
      state: snapshot[capability] as EntitlementState,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      effectiveFrom: params.transitionTime,
      effectiveTo: null,
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
    // Deliberately UNTARGETED `ON CONFLICT DO NOTHING` — Closure Delta #1
    // added `UNIQUE(first_user_id)` alongside the pre-existing
    // `UNIQUE(email_hash)`. Targeting only one column would let a conflict
    // on the OTHER column raise a hard error instead of the intended
    // "not eligible" no-op; omitting the target means Postgres treats a
    // violation of EITHER constraint the same way — no insert, empty
    // `RETURNING`. This is what makes "same owner, changed email" and "new
    // owner, previously-used email" both correctly block a second trial.
    const inserted = await tx
      .insert(ownerTrialGrants)
      .values({ emailHash, firstUserId: input.ownerUserId, firstWorkspaceId: input.workspaceId })
      .onConflictDoNothing()
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

  await recomputeEntitlementSnapshot(tx, {
    workspaceId: input.workspaceId,
    state,
    sourceType: "TRIAL",
    sourceId: subscription.id,
    transitionTime: now,
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
    // ONE instant shared by the Subscription row's own `updated_at` AND the
    // entitlement close/insert pair below — the close's `effective_to` and
    // the new row's `effective_from` must be the exact same value, not
    // merely close in time.
    const transitionTime = new Date();
    const patch: Partial<typeof subscriptions.$inferInsert> = {
      state: input.nextState,
      updatedAt: transitionTime,
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

    await recomputeEntitlementSnapshot(tx, {
      workspaceId: updated.workspaceId,
      state: input.nextState,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      transitionTime,
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
