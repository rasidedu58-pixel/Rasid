import { randomUUID } from "node:crypto";
import type {
  AuditEventInput,
  AuditEventRow,
  DesiredGrantInput,
  GrantWithScopes,
  MembershipRow,
  PermissionGrantRow,
  TeamMemberIdentityRow,
} from "@academic-precision/database";
import type { TeamRepositoryPort } from "../ports/team-repository.port";

/**
 * In-memory test double for {@link TeamRepositoryPort} — mirrors
 * `InMemoryIdentityRepository` (Phase 1): no live Postgres needed for unit
 * tests, but preserves the same soft-revoke / append-only semantics as the
 * real Drizzle repository (grants are never removed from the map, only
 * marked `revokedAt`; audit rows accumulate).
 */
export class InMemoryTeamRepository implements TeamRepositoryPort {
  readonly membershipsById = new Map<string, MembershipRow>();
  readonly grantsById = new Map<string, PermissionGrantRow>();
  readonly groupIdsByGrantId = new Map<string, string[]>();
  readonly auditEvents: AuditEventRow[] = [];
  /** Phase 15C — lets tests assert the membership lookup was (not) re-queried. */
  findMembershipByUserAndWorkspaceCalls = 0;

  private now(): Date {
    return new Date();
  }

  seedMembership(input: {
    id?: string;
    workspaceId: string;
    userId: string;
    roleLabel: string;
    status?: "INVITED" | "ACTIVE" | "DISABLED";
  }): MembershipRow {
    const now = this.now();
    const membership: MembershipRow = {
      id: input.id ?? randomUUID(),
      workspaceId: input.workspaceId,
      userId: input.userId,
      roleLabel: input.roleLabel,
      status: input.status ?? "ACTIVE",
      joinedAt: now,
      disabledAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.membershipsById.set(membership.id, membership);
    return membership;
  }

  async findMembershipById(membershipId: string): Promise<MembershipRow | undefined> {
    return this.membershipsById.get(membershipId);
  }

  async findMembershipByUserAndWorkspace(userId: string, workspaceId: string): Promise<MembershipRow | undefined> {
    this.findMembershipByUserAndWorkspaceCalls += 1;
    for (const m of this.membershipsById.values()) {
      if (m.userId === userId && m.workspaceId === workspaceId) return m;
    }
    return undefined;
  }

  async listMembershipsForWorkspace(workspaceId: string): Promise<MembershipRow[]> {
    return [...this.membershipsById.values()].filter((m) => m.workspaceId === workspaceId);
  }

  /** Optional identity for tests to seed; defaults to nulls (mirrors an RLS-hidden users row). */
  readonly identityByUserId = new Map<string, { fullName: string | null; emailDisplay: string | null; phone: string | null }>();

  async listTeamMembersWithIdentity(workspaceId: string): Promise<TeamMemberIdentityRow[]> {
    return [...this.membershipsById.values()]
      .filter((m) => m.workspaceId === workspaceId)
      .map((m) => {
        const identity = this.identityByUserId.get(m.userId);
        return {
          membership: m,
          fullName: identity?.fullName ?? null,
          emailDisplay: identity?.emailDisplay ?? null,
          phone: identity?.phone ?? null,
        };
      });
  }

  async enableMembership(membershipId: string): Promise<MembershipRow> {
    const existing = this.membershipsById.get(membershipId);
    if (!existing) throw new Error(`Membership ${membershipId} not found in fixture.`);
    const updated: MembershipRow = { ...existing, status: "ACTIVE", disabledAt: null, updatedAt: this.now() };
    this.membershipsById.set(membershipId, updated);
    return updated;
  }

  private grantWithScopes(grant: PermissionGrantRow): GrantWithScopes {
    return { grant, groupIds: this.groupIdsByGrantId.get(grant.id) ?? [] };
  }

  async listActiveGrants(membershipId: string): Promise<GrantWithScopes[]> {
    return [...this.grantsById.values()]
      .filter((g) => g.membershipId === membershipId && g.revokedAt === null)
      .map((g) => this.grantWithScopes(g));
  }

  private sameScope(a: DesiredGrantInput, existing: GrantWithScopes): boolean {
    if (existing.grant.scopeType !== a.scopeType) return false;
    if (a.scopeType === "ALL_GROUPS") return true;
    const existingSet = new Set(existing.groupIds);
    const desiredSet = new Set(a.groupIds ?? []);
    if (existingSet.size !== desiredSet.size) return false;
    for (const id of desiredSet) if (!existingSet.has(id)) return false;
    return true;
  }

  async replaceMembershipGrants(params: {
    workspaceId: string;
    membershipId: string;
    createdByUserId: string;
    desiredGrants: DesiredGrantInput[];
  }): Promise<{ before: GrantWithScopes[]; after: GrantWithScopes[] }> {
    const before = await this.listActiveGrants(params.membershipId);

    for (const existing of before) {
      const stillDesired = params.desiredGrants.some(
        (d) => d.permissionKey === existing.grant.permissionKey && this.sameScope(d, existing),
      );
      if (!stillDesired) {
        this.grantsById.set(existing.grant.id, { ...existing.grant, revokedAt: this.now() });
      }
    }

    for (const desired of params.desiredGrants) {
      const alreadyActive = before.some(
        (existing) => existing.grant.permissionKey === desired.permissionKey && this.sameScope(desired, existing),
      );
      if (alreadyActive) continue;

      const grant: PermissionGrantRow = {
        id: randomUUID(),
        workspaceId: params.workspaceId,
        membershipId: params.membershipId,
        permissionKey: desired.permissionKey,
        scopeType: desired.scopeType,
        createdByUserId: params.createdByUserId,
        createdAt: this.now(),
        revokedAt: null,
      };
      this.grantsById.set(grant.id, grant);
      if (desired.scopeType === "SELECTED_GROUPS" && desired.groupIds) {
        this.groupIdsByGrantId.set(grant.id, [...desired.groupIds]);
      }
    }

    const after = await this.listActiveGrants(params.membershipId);
    return { before, after };
  }

  async disableMembership(membershipId: string): Promise<MembershipRow> {
    const existing = this.membershipsById.get(membershipId);
    if (!existing) throw new Error(`Membership ${membershipId} not found in fixture.`);
    const updated: MembershipRow = {
      ...existing,
      status: "DISABLED",
      disabledAt: this.now(),
      updatedAt: this.now(),
    };
    this.membershipsById.set(membershipId, updated);
    return updated;
  }

  async insertAuditEvent(input: AuditEventInput): Promise<AuditEventRow> {
    const row: AuditEventRow = {
      id: randomUUID(),
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
      createdAt: this.now(),
    };
    this.auditEvents.push(row);
    return row;
  }

  async createMembershipForTesting(input: {
    workspaceId: string;
    userId: string;
    roleLabel: string;
    status?: "INVITED" | "ACTIVE" | "DISABLED";
  }): Promise<MembershipRow> {
    return this.seedMembership(input);
  }
}
