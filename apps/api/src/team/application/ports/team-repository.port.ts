import type {
  AuditEventInput,
  AuditEventRow,
  DesiredGrantInput,
  GrantWithScopes,
  MembershipRow,
  TeamMemberIdentityRow,
} from "@academic-precision/database";

/**
 * Port (dependency-inversion boundary) between the team/permissions
 * application layer and its persistence — mirrors the Phase 1
 * `IdentityRepositoryPort` convention exactly. `DrizzleTeamRepository` is
 * the real implementation; tests supply an in-memory fake.
 */
export interface TeamRepositoryPort {
  findMembershipById(membershipId: string): Promise<MembershipRow | undefined>;
  findMembershipByUserAndWorkspace(
    userId: string,
    workspaceId: string,
  ): Promise<MembershipRow | undefined>;
  listMembershipsForWorkspace(workspaceId: string): Promise<MembershipRow[]>;
  /** Backs the rich `GET /team` — memberships joined to member identity (0053 RLS). */
  listTeamMembersWithIdentity(workspaceId: string): Promise<TeamMemberIdentityRow[]>;
  /** Re-activates a disabled membership (inverse of {@link disableMembership}). */
  enableMembership(membershipId: string): Promise<MembershipRow>;
  /**
   * `workspaceId` is optional at the port level (kept backward-compatible
   * for test doubles) but the real `DrizzleTeamRepository` always receives
   * it explicitly from `PermissionResolverService` — this call is only
   * ever made from `PermissionGuard`, i.e. BEFORE the request-context
   * interceptor runs, so ambient ExecutionContext is not yet available and
   * an explicit `workspaceId` is required for RLS to admit the read.
   */
  listActiveGrants(membershipId: string, workspaceId?: string): Promise<GrantWithScopes[]>;
  replaceMembershipGrants(params: {
    workspaceId: string;
    membershipId: string;
    createdByUserId: string;
    desiredGrants: DesiredGrantInput[];
  }): Promise<{ before: GrantWithScopes[]; after: GrantWithScopes[] }>;
  disableMembership(membershipId: string): Promise<MembershipRow>;
  insertAuditEvent(input: AuditEventInput): Promise<AuditEventRow>;
  /**
   * Phase 2 testing/foundation helper; a real invited-acceptance flow
   * replaces the caller of this in a later phase. NOT exposed as a public
   * HTTP endpoint — see packages/database's `createMembershipForTesting`.
   */
  createMembershipForTesting(input: {
    workspaceId: string;
    userId: string;
    roleLabel: string;
    status?: "INVITED" | "ACTIVE" | "DISABLED";
  }): Promise<MembershipRow>;
}

export const TEAM_REPOSITORY = Symbol("TEAM_REPOSITORY");
