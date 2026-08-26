/**
 * Permissions/Team repository — Phase 2.
 *
 * Typed query helpers for memberships (status transitions),
 * permission_grants, permission_group_scopes and audit_events. Contains no
 * HTTP/framework concerns; callers (apps/api) inject a database handle,
 * mirroring the Phase 1 `identity.repository.ts` convention exactly.
 */
import { and, eq, isNull } from "drizzle-orm";
import { memberships, permissionGrants, permissionGroupScopes } from "../schema/permissions";
import { auditEvents } from "../schema/audit";
import type { Db, MembershipRow } from "./identity.repository";

export type PermissionGrantRow = typeof permissionGrants.$inferSelect;
export type PermissionGroupScopeRow = typeof permissionGroupScopes.$inferSelect;
export type AuditEventRow = typeof auditEvents.$inferSelect;

const ACTIVE_MEMBERSHIP_STATUS = "ACTIVE";
const DISABLED_MEMBERSHIP_STATUS = "DISABLED";

export function findMembershipById(db: Db, membershipId: string): Promise<MembershipRow | undefined> {
  return db
    .select()
    .from(memberships)
    .where(eq(memberships.id, membershipId))
    .limit(1)
    .then((rows) => rows[0]);
}

export function findActiveOrAnyMembership(
  db: Db,
  workspaceId: string,
  userId: string,
): Promise<MembershipRow | undefined> {
  return db
    .select()
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
    .limit(1)
    .then((rows) => rows[0]);
}

export function listMembershipsForWorkspace(db: Db, workspaceId: string): Promise<MembershipRow[]> {
  return db.select().from(memberships).where(eq(memberships.workspaceId, workspaceId));
}

export interface GrantWithScopes {
  grant: PermissionGrantRow;
  groupIds: string[];
}

/**
 * Non-revoked grants for a membership, each joined to its group-scope rows
 * (if any). Phase 15 latency fix: was one query per SELECTED_GROUPS grant
 * (a real N+1 — each extra query costs a full network round-trip on the
 * deployed topology); now a single LEFT JOIN regrouped in JS.
 */
export async function listActiveGrantsForMembership(
  db: Db,
  membershipId: string,
): Promise<GrantWithScopes[]> {
  const rows = await db
    .select({ grant: permissionGrants, scopeGroupId: permissionGroupScopes.groupId })
    .from(permissionGrants)
    .leftJoin(permissionGroupScopes, eq(permissionGroupScopes.permissionGrantId, permissionGrants.id))
    .where(and(eq(permissionGrants.membershipId, membershipId), isNull(permissionGrants.revokedAt)));

  const byGrantId = new Map<string, GrantWithScopes>();
  for (const row of rows) {
    let entry = byGrantId.get(row.grant.id);
    if (!entry) {
      entry = { grant: row.grant, groupIds: [] };
      byGrantId.set(row.grant.id, entry);
    }
    if (row.scopeGroupId !== null) {
      entry.groupIds.push(row.scopeGroupId);
    }
  }
  return [...byGrantId.values()];
}

export interface DesiredGrantInput {
  permissionKey: string;
  scopeType: "ALL_GROUPS" | "SELECTED_GROUPS";
  groupIds?: string[];
}

/**
 * Transactionally replaces a membership's active grant set with
 * `desiredGrants`: revokes (soft — `revoked_at`, never hard-deleted) any
 * active grant not present (by permission key + identical scope) in the
 * desired set, and inserts fresh grant rows (+ group-scope rows) for
 * entries not already satisfied by an existing active grant. Returns the
 * before/after active-grant snapshots for the audit_events row.
 */
export async function replaceMembershipGrants(
  db: Db,
  params: {
    workspaceId: string;
    membershipId: string;
    createdByUserId: string;
    desiredGrants: DesiredGrantInput[];
  },
): Promise<{ before: GrantWithScopes[]; after: GrantWithScopes[] }> {
  return db.transaction(async (tx) => {
    const txDb = tx as unknown as Db;
    const before = await listActiveGrantsForMembership(txDb, params.membershipId);

    const sameScope = (a: DesiredGrantInput, existing: GrantWithScopes): boolean => {
      if (existing.grant.scopeType !== a.scopeType) return false;
      if (a.scopeType === "ALL_GROUPS") return true;
      const existingSet = new Set(existing.groupIds);
      const desiredSet = new Set(a.groupIds ?? []);
      if (existingSet.size !== desiredSet.size) return false;
      for (const id of desiredSet) if (!existingSet.has(id)) return false;
      return true;
    };

    for (const existing of before) {
      const stillDesired = params.desiredGrants.some(
        (d) => d.permissionKey === existing.grant.permissionKey && sameScope(d, existing),
      );
      if (!stillDesired) {
        await tx
          .update(permissionGrants)
          .set({ revokedAt: new Date() })
          .where(eq(permissionGrants.id, existing.grant.id));
      }
    }

    for (const desired of params.desiredGrants) {
      const alreadyActive = before.some(
        (existing) => existing.grant.permissionKey === desired.permissionKey && sameScope(desired, existing),
      );
      if (alreadyActive) continue;

      const [inserted] = await tx
        .insert(permissionGrants)
        .values({
          workspaceId: params.workspaceId,
          membershipId: params.membershipId,
          permissionKey: desired.permissionKey,
          scopeType: desired.scopeType,
          createdByUserId: params.createdByUserId,
        })
        .returning();

      if (!inserted) {
        throw new Error(`Failed to insert permission_grants row for ${desired.permissionKey}.`);
      }

      if (desired.scopeType === "SELECTED_GROUPS" && desired.groupIds && desired.groupIds.length > 0) {
        await tx.insert(permissionGroupScopes).values(
          desired.groupIds.map((groupId) => ({ permissionGrantId: inserted.id, groupId })),
        );
      }
    }

    const after = await listActiveGrantsForMembership(txDb, params.membershipId);
    return { before, after };
  });
}

export async function disableMembership(db: Db, membershipId: string): Promise<MembershipRow> {
  const now = new Date();
  const [updated] = await db
    .update(memberships)
    .set({ status: DISABLED_MEMBERSHIP_STATUS, disabledAt: now, updatedAt: now })
    .where(eq(memberships.id, membershipId))
    .returning();

  if (!updated) {
    throw new Error(`Membership ${membershipId} not found while disabling.`);
  }
  return updated;
}

export interface AuditEventInput {
  workspaceId: string;
  actorUserId: string | null;
  actorMembershipId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  beforeJson?: unknown;
  afterJson?: unknown;
  reason?: string | null;
  correlationId?: string | null;
}

export async function insertAuditEvent(db: Db, input: AuditEventInput): Promise<AuditEventRow> {
  const [inserted] = await db
    .insert(auditEvents)
    .values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      actorMembershipId: input.actorMembershipId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      beforeJson: input.beforeJson ?? null,
      afterJson: input.afterJson ?? null,
      reason: input.reason ?? null,
      correlationId: input.correlationId ?? null,
    })
    .returning();

  if (!inserted) {
    throw new Error("Failed to insert audit_events row.");
  }
  return inserted;
}

/**
 * Phase 2 testing/foundation helper — creates a membership row directly for
 * a given (workspaceId, userId, roleLabel), bypassing the (not-yet-built)
 * team-invitation acceptance flow. NOT exposed as a public HTTP endpoint —
 * a real invited-acceptance flow replaces the caller of this in a later
 * phase (workspace_invitations table). Used only by Phase 2 tests/fixtures
 * to exercise non-owner membership scenarios (§8 of the Phase 2 spec).
 */
export async function createMembershipForTesting(
  db: Db,
  input: { workspaceId: string; userId: string; roleLabel: string; status?: "INVITED" | "ACTIVE" | "DISABLED" },
): Promise<MembershipRow> {
  const [inserted] = await db
    .insert(memberships)
    .values({
      workspaceId: input.workspaceId,
      userId: input.userId,
      roleLabel: input.roleLabel,
      status: input.status ?? ACTIVE_MEMBERSHIP_STATUS,
      joinedAt: new Date(),
    })
    .returning();

  if (!inserted) {
    throw new Error("Failed to insert membership row (testing helper).");
  }
  return inserted;
}
