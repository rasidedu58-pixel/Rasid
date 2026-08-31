import { Injectable } from "@nestjs/common";
import {
  createMembershipForTesting,
  disableMembership,
  enableMembership,
  findActiveOrAnyMembership,
  findMembershipById,
  findWorkspaceStatus,
  getDb,
  insertAuditEvent,
  listActiveGrantsForMembership,
  listMembershipsForWorkspace,
  listTeamMembersWithIdentity,
  replaceMembershipGrants,
  withRuntimeContext,
  type AuditEventInput,
  type AuditEventRow,
  type DesiredGrantInput,
  type GrantWithScopes,
  type MembershipRow,
  type TeamMemberIdentityRow,
} from "@academic-precision/database";
import { getContext } from "@academic-precision/observability";
import type { TeamRepositoryPort } from "../application/ports/team-repository.port";

/**
 * Real (PostgreSQL/Drizzle) implementation of {@link TeamRepositoryPort}.
 * Thin adapter only — all persistence/transaction logic lives in
 * packages/database, mirroring `DrizzleIdentityRepository` (Phase 1).
 *
 * All of Phase 2's Team module operations already have an authorized
 * `workspaceId` available by the time they reach these functions (resolved
 * and verified by `PermissionGuard` before the service layer runs), so
 * every method threads it (plus `app.user_id`) through
 * `withRuntimeContext`. Per-method comments explain where that
 * `workspaceId` comes from — an explicit method parameter where one is
 * already available and more trustworthy than ambient context, or the
 * ambient `ExecutionContext` (set by `RequestContextInterceptor` from
 * `PermissionGuard`'s resolved `WORKSPACE_CONTEXT_REQUEST_KEY`) otherwise.
 */
@Injectable()
export class DrizzleTeamRepository implements TeamRepositoryPort {
  /**
   * Called only from `TeamService.loadTargetMembership`, i.e. after
   * `PermissionGuard` has already run and `RequestContextInterceptor` has
   * ambient context active — no explicit workspaceId parameter exists on
   * this method, so read both values from context.
   */
  findMembershipById(membershipId: string): Promise<MembershipRow | undefined> {
    const ctx = getContext();
    return withRuntimeContext(
      { userId: ctx?.userId, workspaceId: ctx?.workspaceId as string | undefined },
      (db) => findMembershipById(db, membershipId),
    );
  }

  /**
   * Called ONLY from `PermissionGuard.canActivate` (via
   * `PermissionResolverService.findActiveMembership`) — BEFORE
   * `RequestContextInterceptor` runs (Guards execute before Interceptors),
   * so no ambient context exists yet. Both `userId`/`workspaceId` are
   * already explicit parameters here — use them directly rather than
   * (unavailable) ambient context.
   */
  findMembershipByUserAndWorkspace(userId: string, workspaceId: string): Promise<MembershipRow | undefined> {
    return withRuntimeContext({ userId, workspaceId }, (db) => findActiveOrAnyMembership(db, workspaceId, userId));
  }

  /**
   * Also called from `PermissionGuard.canActivate` (after the membership is
   * resolved) — same pre-interceptor timing, so pass the explicit
   * `userId`/`workspaceId` through `withRuntimeContext`. A member may read
   * their own workspace row under RLS, so this returns the status even for a
   * SUSPENDED workspace (which is exactly what the guard needs to block on).
   */
  findWorkspaceStatus(workspaceId: string): Promise<string | undefined> {
    const ctx = getContext();
    return withRuntimeContext(
      { userId: ctx?.userId, workspaceId },
      (db) => findWorkspaceStatus(db, workspaceId),
    );
  }

  /** Backs `GET /team`; `workspaceId` is an explicit, guard-verified parameter — prefer it over ambient context. */
  listMembershipsForWorkspace(workspaceId: string): Promise<MembershipRow[]> {
    const ctx = getContext();
    return withRuntimeContext({ userId: ctx?.userId, workspaceId }, (db) => listMembershipsForWorkspace(db, workspaceId));
  }

  /** Backs the rich `GET /team`; identity join is admitted by 0053's co-member RLS policy. */
  listTeamMembersWithIdentity(workspaceId: string): Promise<TeamMemberIdentityRow[]> {
    const ctx = getContext();
    return withRuntimeContext({ userId: ctx?.userId, workspaceId }, (db) => listTeamMembersWithIdentity(db, workspaceId));
  }

  /**
   * Called only from `TeamService.enableMembership`, after `loadTargetMembership`
   * verified the target belongs to the caller's own (ambient-context) workspace.
   */
  enableMembership(membershipId: string): Promise<MembershipRow> {
    const ctx = getContext();
    return withRuntimeContext(
      { userId: ctx?.userId, workspaceId: ctx?.workspaceId as string | undefined },
      (db) => enableMembership(db, membershipId),
    );
  }

  /**
   * Called ONLY from `PermissionResolverService.resolveEffectivePermissions`,
   * itself only reachable from `PermissionGuard` — i.e. before
   * `RequestContextInterceptor` runs. `workspaceId` is passed explicitly by
   * the resolver (see `PermissionResolverService`) for exactly this reason;
   * fall back to ambient context only for callers/tests that omit it.
   */
  listActiveGrants(membershipId: string, workspaceId?: string): Promise<GrantWithScopes[]> {
    const ctx = getContext();
    const resolvedWorkspaceId = workspaceId ?? (ctx?.workspaceId as string | undefined);
    return withRuntimeContext(
      { userId: ctx?.userId, workspaceId: resolvedWorkspaceId },
      (db) => listActiveGrantsForMembership(db, membershipId),
    );
  }

  /** `params.workspaceId` is an explicit, guard-verified parameter — prefer it over ambient context. */
  replaceMembershipGrants(params: {
    workspaceId: string;
    membershipId: string;
    createdByUserId: string;
    desiredGrants: DesiredGrantInput[];
  }): Promise<{ before: GrantWithScopes[]; after: GrantWithScopes[] }> {
    const ctx = getContext();
    return withRuntimeContext(
      { userId: ctx?.userId, workspaceId: params.workspaceId },
      (db) => replaceMembershipGrants(db, params),
    );
  }

  /**
   * Called only from `TeamService.disableMembership`, after
   * `loadTargetMembership` has already verified the target belongs to the
   * caller's own (ambient-context) workspace — no explicit workspaceId
   * parameter exists on this method, so read both values from context.
   */
  disableMembership(membershipId: string): Promise<MembershipRow> {
    const ctx = getContext();
    return withRuntimeContext(
      { userId: ctx?.userId, workspaceId: ctx?.workspaceId as string | undefined },
      (db) => disableMembership(db, membershipId),
    );
  }

  /** `input.workspaceId` is an explicit, guard-verified parameter — prefer it over ambient context. */
  insertAuditEvent(input: AuditEventInput): Promise<AuditEventRow> {
    const ctx = getContext();
    return withRuntimeContext(
      { userId: ctx?.userId, workspaceId: input.workspaceId },
      (db) => insertAuditEvent(db, input),
    );
  }

  /**
   * Phase 2 testing/foundation helper — NOT reachable from any public HTTP
   * route (see packages/database's `createMembershipForTesting` doc
   * comment). Uses the plain (unscoped) `getDb()` connection directly:
   * fixture/test-arrangement helpers are expected to run against a
   * privileged connection in the new RLS integration tests (seed via the
   * admin connection, then attempt access with the restricted runtime
   * connection under test) — this is standard RLS-test practice and is not
   * part of the runtime API request path this security delta hardens.
   */
  createMembershipForTesting(input: {
    workspaceId: string;
    userId: string;
    roleLabel: string;
    status?: "INVITED" | "ACTIVE" | "DISABLED";
  }): Promise<MembershipRow> {
    return createMembershipForTesting(getDb(), input);
  }
}
