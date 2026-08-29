/**
 * Workspace-invitations repository — Team & Permissions Phase 2.
 *
 * Backs the owner-shared invitation-link flow. The RAW token never appears
 * here: callers pass only its SHA-256 hex digest (`tokenHash`). The security
 * centre of this module is {@link acceptInvitationTx} — the ENTIRE
 * acceptance runs inside ONE transaction (the caller's
 * `withRuntimeContext({ userId })`), guarded against double-accept by an
 * atomic `UPDATE ... WHERE status = 'PENDING'` row lock, and fails closed for
 * expired / revoked / already-accepted invitations.
 */
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { workspaceInvitations, type InvitationDesiredGrant } from "../schema/workspace-invitations";
export type { InvitationDesiredGrant } from "../schema/workspace-invitations";
import { workspaces } from "../schema/workspaces";
import { memberships } from "../schema/permissions";
import { replaceMembershipGrants, insertAuditEvent, type DesiredGrantInput } from "./permissions.repository";
import type { Db } from "./identity.repository";

export type InvitationRow = typeof workspaceInvitations.$inferSelect;

const ACTIVE_MEMBERSHIP_STATUS = "ACTIVE";

export interface CreateInvitationInput {
  workspaceId: string;
  tokenHash: string;
  roleLabel: string;
  desiredGrants: InvitationDesiredGrant[];
  invitedLabel: string | null;
  invitedByUserId: string;
  expiresAt: Date;
}

/** Inserts a PENDING invitation. Caller wraps in workspace-scoped context. */
export async function createInvitation(db: Db, input: CreateInvitationInput): Promise<InvitationRow> {
  const [inserted] = await db
    .insert(workspaceInvitations)
    .values({
      workspaceId: input.workspaceId,
      tokenHash: input.tokenHash,
      roleLabel: input.roleLabel,
      desiredGrants: input.desiredGrants,
      invitedLabel: input.invitedLabel,
      status: "PENDING",
      invitedByUserId: input.invitedByUserId,
      expiresAt: input.expiresAt,
    })
    .returning();

  if (!inserted) {
    throw new Error("Failed to insert workspace_invitations row.");
  }
  return inserted;
}

/** All invitations for a workspace, newest first (management view). */
export function listInvitations(db: Db, workspaceId: string): Promise<InvitationRow[]> {
  return db
    .select()
    .from(workspaceInvitations)
    .where(eq(workspaceInvitations.workspaceId, workspaceId))
    .orderBy(desc(workspaceInvitations.createdAt));
}

export function findInvitationById(db: Db, invitationId: string): Promise<InvitationRow | undefined> {
  return db
    .select()
    .from(workspaceInvitations)
    .where(eq(workspaceInvitations.id, invitationId))
    .limit(1)
    .then((rows) => rows[0]);
}

/**
 * Revokes a PENDING invitation (atomic — only flips if still PENDING). A
 * revoked or already-accepted invitation returns `undefined` (no-op), so the
 * service can report the same safe outcome without leaking prior state.
 */
export async function revokeInvitation(db: Db, invitationId: string): Promise<InvitationRow | undefined> {
  const [updated] = await db
    .update(workspaceInvitations)
    .set({ status: "REVOKED", revokedAt: new Date() })
    .where(and(eq(workspaceInvitations.id, invitationId), eq(workspaceInvitations.status, "PENDING")))
    .returning();
  return updated;
}

/**
 * Reads an invitation by token hash for the ACCEPT/PREVIEW path, where the
 * caller is authenticated but NOT yet a member (no workspace context). Sets
 * the transaction-scoped `app.invite_token_hash` GUC so the token-read RLS
 * policy (0054) admits exactly the matching row. MUST run inside a
 * transaction (`db` from `withRuntimeContext`).
 */
export async function findInvitationByTokenHashTx(db: Db, tokenHash: string): Promise<InvitationRow | undefined> {
  await db.execute(sql`SELECT set_config('app.invite_token_hash', ${tokenHash}, true)`);
  return db
    .select()
    .from(workspaceInvitations)
    .where(eq(workspaceInvitations.tokenHash, tokenHash))
    .limit(1)
    .then((rows) => rows[0]);
}

export interface InvitationPreview {
  status: "PENDING" | "ACCEPTED" | "REVOKED";
  valid: boolean;
  roleLabel: string;
  workspaceId: string;
  workspaceName: string | null;
  expiresAt: string;
  desiredGrants: InvitationDesiredGrant[];
}

/**
 * Read-only preview for the accept page — resolves the invite by token (GUC
 * policy), then reads the workspace name under that workspace's context
 * (admitted by `workspaces_tenant_isolation`). Never mutates anything.
 */
export async function previewInvitationTx(db: Db, tokenHash: string): Promise<InvitationPreview | null> {
  const invite = await findInvitationByTokenHashTx(db, tokenHash);
  if (!invite) return null;

  await db.execute(sql`SELECT set_config('app.workspace_id', ${invite.workspaceId}, true)`);
  const workspace = await db
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, invite.workspaceId))
    .limit(1)
    .then((rows) => rows[0]);

  const valid = invite.status === "PENDING" && invite.expiresAt.getTime() > Date.now();
  return {
    status: invite.status as InvitationPreview["status"],
    valid,
    roleLabel: invite.roleLabel,
    workspaceId: invite.workspaceId,
    workspaceName: workspace?.name ?? null,
    expiresAt: invite.expiresAt.toISOString(),
    desiredGrants: invite.desiredGrants,
  };
}

export type AcceptInvitationResult =
  | { ok: true; workspaceId: string; membershipId: string; roleLabel: string }
  | { ok: false; reason: "INVALID" | "ALREADY_MEMBER" };

/**
 * Accepts an invitation ATOMICALLY. `db` MUST be the transaction opened by
 * `withRuntimeContext({ userId: accepterUserId })`, so every step below —
 * the token read, the race-guard flip, the membership + grants + audit
 * writes — commits or rolls back as one unit.
 *
 * Ordering and guarantees:
 *   1. Read the invite by token GUC (no workspace context yet).
 *   2. Fail closed unless it is PENDING and unexpired.
 *   3. Switch to the invite's workspace context for all subsequent writes.
 *   4. If the caller is already a member → ALREADY_MEMBER, invite untouched.
 *   5. Race guard: `UPDATE ... WHERE status='PENDING' AND expires_at > now()`
 *      RETURNING — a second concurrent accept of the same token blocks on the
 *      row lock, then matches 0 rows and fails closed (also backstopped by
 *      the memberships unique(workspace,user) constraint).
 *   6. Create the ACTIVE membership, apply the pre-authorized grants, link the
 *      invite to the new membership, and write the audit event.
 */
export async function acceptInvitationTx(
  db: Db,
  params: { tokenHash: string; accepterUserId: string },
): Promise<AcceptInvitationResult> {
  const invite = await findInvitationByTokenHashTx(db, params.tokenHash);
  if (!invite) return { ok: false, reason: "INVALID" };
  if (invite.status !== "PENDING" || invite.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "INVALID" };
  }

  // All writes from here run under the invite's workspace context.
  await db.execute(sql`SELECT set_config('app.workspace_id', ${invite.workspaceId}, true)`);

  const existingMembership = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, invite.workspaceId), eq(memberships.userId, params.accepterUserId)))
    .limit(1)
    .then((rows) => rows[0]);
  if (existingMembership) return { ok: false, reason: "ALREADY_MEMBER" };

  // Atomic single-use guard — only the transaction that flips PENDING → ACCEPTED
  // proceeds; any concurrent accept of the same token matches 0 rows here.
  const [claimed] = await db
    .update(workspaceInvitations)
    .set({ status: "ACCEPTED", acceptedByUserId: params.accepterUserId, acceptedAt: new Date() })
    .where(
      and(
        eq(workspaceInvitations.id, invite.id),
        eq(workspaceInvitations.status, "PENDING"),
        gt(workspaceInvitations.expiresAt, sql`now()`),
      ),
    )
    .returning();
  if (!claimed) return { ok: false, reason: "INVALID" };

  const [membership] = await db
    .insert(memberships)
    .values({
      workspaceId: invite.workspaceId,
      userId: params.accepterUserId,
      roleLabel: invite.roleLabel,
      status: ACTIVE_MEMBERSHIP_STATUS,
      joinedAt: new Date(),
    })
    .returning();
  if (!membership) {
    throw new Error("Failed to insert membership row during invitation acceptance.");
  }

  const desiredGrants: DesiredGrantInput[] = invite.desiredGrants.map((g) => ({
    permissionKey: g.permissionKey,
    scopeType: g.scopeType,
    groupIds: g.groupIds,
  }));
  await replaceMembershipGrants(db, {
    workspaceId: invite.workspaceId,
    membershipId: membership.id,
    // Attributed to the owner who authorized the grants at invite time.
    createdByUserId: invite.invitedByUserId,
    desiredGrants,
  });

  await db
    .update(workspaceInvitations)
    .set({ acceptedMembershipId: membership.id })
    .where(eq(workspaceInvitations.id, invite.id));

  await insertAuditEvent(db, {
    workspaceId: invite.workspaceId,
    actorUserId: params.accepterUserId,
    actorMembershipId: membership.id,
    action: "invitation.accepted",
    entityType: "membership",
    entityId: membership.id,
    afterJson: { roleLabel: invite.roleLabel, invitationId: invite.id },
  });

  return { ok: true, workspaceId: invite.workspaceId, membershipId: membership.id, roleLabel: invite.roleLabel };
}
