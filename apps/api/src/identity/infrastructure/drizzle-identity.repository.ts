import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  completeOnboarding,
  createUserWorkspaceMembership,
  findMembership,
  findSubscriptionByWorkspaceId,
  listAllowedEntitlementsForWorkspace,
  listMembershipsForUser,
  loadProvisionedIdentity,
  withRuntimeContext,
  type EntitlementRow,
  type MembershipWithWorkspace,
  type OnboardingCompleteInput,
  type ProvisionedIdentity,
  type ProvisionInput,
  type SubscriptionRow,
  type WorkspaceRow,
} from "@academic-precision/database";
import { getContext } from "@academic-precision/observability";
import type { IdentityRepositoryPort } from "../application/ports/identity-repository.port";

/**
 * Real (PostgreSQL/Drizzle) implementation of {@link IdentityRepositoryPort}.
 * Thin adapter only — all persistence/transaction logic lives in
 * packages/database (single source of truth, reused by any future caller).
 *
 * Every method threads `app.user_id`/`app.workspace_id` into the RLS
 * Security Delta's `withRuntimeContext` — see per-method comments for which
 * context values each one runs under and why.
 */
@Injectable()
export class DrizzleIdentityRepository implements IdentityRepositoryPort {
  /**
   * Pre-generates the workspace's id (Node's built-in `crypto.randomUUID()`
   * — no new dependency needed) BEFORE the insert, so `app.workspace_id`
   * can be `SET LOCAL`'d to it up front: the 0005 tenant-isolation RLS
   * policy's `WITH CHECK` (same expression as `USING`, since it has no
   * explicit `FOR` clause) would otherwise reject the INSERT because the id
   * isn't known — and couldn't be `SET LOCAL`'d — until after the row
   * exists. `userId` is also set (`input.authUserId`) so the memberships
   * insert's `WITH CHECK` (`user_id = current_setting('app.user_id')`) is
   * satisfiable for the owner's own membership row. When this call instead
   * hits the idempotent "already provisioned" branch, the pregenerated id
   * is simply unused for the read-back — that path relies on the new
   * `memberships_self_read`/`workspaces_self_membership_read` policies
   * (keyed on `app.user_id`, not `app.workspace_id`).
   */
  async provision(input: ProvisionInput): Promise<ProvisionedIdentity> {
    // Phase 15 latency fix — steady-state fast path: every request after
    // the very first for an identity used to pay the full write
    // transaction (INSERT … ON CONFLICT + savepoint + read-back) just to
    // discover it was already provisioned. A plain read-only lookup under
    // the same `app.user_id` self-read RLS policies answers that in fewer
    // round-trips and zero writes. Concurrency-safe: two concurrent
    // first-requests both miss the fast path and fall through to the
    // idempotent write transaction below, exactly as before.
    const existing = await withRuntimeContext({ userId: input.authUserId }, (db) =>
      loadProvisionedIdentity(db, input.authUserId),
    );
    if (existing) return existing;

    const pregeneratedWorkspaceId = randomUUID();
    return withRuntimeContext(
      { userId: input.authUserId, workspaceId: pregeneratedWorkspaceId },
      (db) => createUserWorkspaceMembership(db, input, pregeneratedWorkspaceId),
    );
  }

  /**
   * Backs `GET /me`: fundamentally cross-workspace-by-self-identity (a
   * user's memberships may span multiple workspaces at once), so only
   * `app.user_id` is set — never require a single `workspaceId` here. This
   * relies on the `memberships_self_read`/`workspaces_self_membership_read`
   * self-access policies, not the 0005 workspace-scoped ones.
   */
  listMemberships(userId: string): Promise<MembershipWithWorkspace[]> {
    return withRuntimeContext({ userId }, (db) => listMembershipsForUser(db, userId));
  }

  /**
   * Backs `GET /me/workspaces/:id/context`: checks one specific workspace,
   * already available as an explicit, guard-verified parameter — set both
   * `app.user_id` and `app.workspace_id` to it.
   */
  findMembership(workspaceId: string, userId: string): Promise<MembershipWithWorkspace | undefined> {
    return withRuntimeContext({ userId, workspaceId }, (db) => findMembership(db, workspaceId, userId));
  }

  /**
   * Updates the target workspace row directly; `input.workspaceId` is
   * already an explicit, more-trustworthy parameter than whatever happens
   * to be in ambient request context, so it wins.
   */
  completeOnboarding(input: OnboardingCompleteInput): Promise<WorkspaceRow> {
    const ctx = getContext();
    return withRuntimeContext(
      { userId: ctx?.userId, workspaceId: input.workspaceId },
      (db) => completeOnboarding(db, input),
    );
  }

  findSubscriptionByWorkspaceId(workspaceId: string): Promise<SubscriptionRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(workspaceId), (db) => findSubscriptionByWorkspaceId(db, workspaceId));
  }

  listAllowedEntitlementsForWorkspace(workspaceId: string): Promise<EntitlementRow[]> {
    return withRuntimeContext(this.runtimeCtx(workspaceId), (db) => listAllowedEntitlementsForWorkspace(db, workspaceId));
  }

  private runtimeCtx(workspaceId: string) {
    const ctx = getContext();
    return { userId: ctx?.userId, workspaceId };
  }
}
