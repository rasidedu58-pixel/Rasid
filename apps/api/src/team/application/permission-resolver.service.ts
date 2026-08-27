import { Inject, Injectable } from "@nestjs/common";
import {
  PERMISSION_KEYS,
  closurePermissionKeys,
  type PermissionKey,
  type ScopeType,
} from "@academic-precision/contracts";
import type { MembershipRow } from "@academic-precision/database";
import { getContext } from "@academic-precision/observability";
import { TEAM_REPOSITORY, type TeamRepositoryPort } from "./ports/team-repository.port";

const OWNER_ROLE_LABEL = "OWNER";
const ACTIVE_STATUS = "ACTIVE";

export interface EffectiveGrant {
  permission: PermissionKey;
  scope: ScopeType;
  /** Only set (and meaningful) when scope === 'SELECTED_GROUPS'. */
  groupIds?: string[];
}

/**
 * Effective-permission resolution — Phase 2 spec §5.
 *
 * - Owner (ACTIVE membership): full implicit access to every catalog
 *   permission, workspace-wide (ALL_GROUPS), without needing explicit
 *   `permission_grants` rows.
 * - Otherwise: union of non-revoked grants for the active membership, PLUS
 *   every permission implied by dependency closure — recomputed here on
 *   every call rather than trusted from stored rows (Phase 2 spec §4).
 * - A non-ACTIVE (e.g. DISABLED) membership always yields zero effective
 *   permissions.
 */
@Injectable()
export class PermissionResolverService {
  constructor(@Inject(TEAM_REPOSITORY) private readonly repository: TeamRepositoryPort) {}

  /**
   * Phase 15 latency fix — request-scoped memoization. The measured
   * production waterfall showed the SAME membership row fetched 3× and the
   * SAME grant set resolved 2× within one request (guard → resolver →
   * service defensive re-check), each a full RLS transaction costing
   * multiple network round-trips. Within a single request the answer
   * cannot change, so both lookups are memoized against the request's own
   * AsyncLocalStorage context object (WeakMap ⇒ dropped automatically when
   * the request context is garbage-collected — no TTL/invalidations to get
   * wrong). Promises are cached (not values) so concurrent callers within
   * one request also coalesce into a single query. Outside a request
   * context (tests, jobs) this transparently degrades to uncached calls.
   * Security note: this NEVER caches across requests — a permission change
   * is visible on the very next request, exactly as before.
   */
  private readonly membershipMemo = new WeakMap<object, Map<string, Promise<MembershipRow | undefined>>>();
  private readonly grantsMemo = new WeakMap<object, Map<string, Promise<EffectiveGrant[]>>>();

  private memoized<T>(
    memo: WeakMap<object, Map<string, Promise<T>>>,
    key: string,
    compute: () => Promise<T>,
  ): Promise<T> {
    const store = getContext();
    if (!store) return compute();
    let perRequest = memo.get(store);
    if (!perRequest) {
      perRequest = new Map();
      memo.set(store, perRequest);
    }
    let promise = perRequest.get(key);
    if (!promise) {
      promise = compute();
      perRequest.set(key, promise);
    }
    return promise;
  }

  findActiveMembership(workspaceId: string, userId: string): Promise<MembershipRow | undefined> {
    return this.memoized(this.membershipMemo, `${workspaceId}:${userId}`, async () => {
      const membership = await this.repository.findMembershipByUserAndWorkspace(userId, workspaceId);
      return membership && membership.status === ACTIVE_STATUS ? membership : undefined;
    });
  }

  /**
   * Phase 15C — accepts the membership row `PermissionGuard` already fetched
   * for this exact (workspaceId, userId), so callers on the request's hot
   * path can avoid re-querying it. The hint is USED ONLY if it genuinely
   * matches this workspace+user and is ACTIVE — otherwise it is ignored and
   * the row is fetched exactly as before. This never widens access: a
   * mismatched or non-active hint falls through to the real lookup, and the
   * final data query still runs under RLS. When no hint is passed behaviour
   * is byte-for-byte identical to before (every existing caller).
   */
  private usableMembershipHint(
    hint: MembershipRow | undefined,
    workspaceId: string,
    userId: string,
  ): MembershipRow | undefined {
    return hint && hint.workspaceId === workspaceId && hint.userId === userId && hint.status === ACTIVE_STATUS
      ? hint
      : undefined;
  }

  resolveEffectivePermissions(
    workspaceId: string,
    userId: string,
    knownActiveMembership?: MembershipRow,
  ): Promise<EffectiveGrant[]> {
    return this.memoized(this.grantsMemo, `${workspaceId}:${userId}`, async () => {
      const membership =
        this.usableMembershipHint(knownActiveMembership, workspaceId, userId) ??
        (await this.findActiveMembership(workspaceId, userId));
      if (!membership) {
        return [];
      }

      if (membership.roleLabel === OWNER_ROLE_LABEL) {
        return PERMISSION_KEYS.map((permission) => ({ permission, scope: "ALL_GROUPS" as const }));
      }

      const grants = await this.repository.listActiveGrants(membership.id, workspaceId);
      return this.computeClosure(
        grants.map((g) => ({
          permissionKey: g.grant.permissionKey as PermissionKey,
          scopeType: g.grant.scopeType as ScopeType,
          groupIds: g.groupIds,
        })),
      );
    });
  }

  private computeClosure(
    grants: { permissionKey: PermissionKey; scopeType: ScopeType; groupIds: string[] }[],
  ): EffectiveGrant[] {
    const effective = new Map<PermissionKey, EffectiveGrant>();

    for (const grant of grants) {
      const closure = closurePermissionKeys(grant.permissionKey);
      for (const impliedKey of closure) {
        const existing = effective.get(impliedKey);

        if (!existing) {
          effective.set(impliedKey, {
            permission: impliedKey,
            scope: grant.scopeType,
            groupIds: grant.scopeType === "SELECTED_GROUPS" ? [...grant.groupIds] : undefined,
          });
          continue;
        }

        // ALL_GROUPS dominates any SELECTED_GROUPS grant for the same
        // (implied) permission key; two SELECTED_GROUPS grants union.
        if (existing.scope === "ALL_GROUPS") continue;
        if (grant.scopeType === "ALL_GROUPS") {
          effective.set(impliedKey, { permission: impliedKey, scope: "ALL_GROUPS" });
          continue;
        }
        existing.groupIds = Array.from(new Set([...(existing.groupIds ?? []), ...grant.groupIds]));
      }
    }

    return [...effective.values()];
  }

  async hasPermission(
    workspaceId: string,
    userId: string,
    permission: PermissionKey,
    knownActiveMembership?: MembershipRow,
  ): Promise<EffectiveGrant | undefined> {
    const effective = await this.resolveEffectivePermissions(workspaceId, userId, knownActiveMembership);
    return effective.find((g) => g.permission === permission);
  }

  /**
   * Reusable helper for group-scoped checks (Phase 2 spec §6): is
   * `groupId` within the caller's effective scope for `permission`?
   * Phase 3 is the first real caller against actual Group resources —
   * Phase 2 only needs to prove the mechanism, exercised by tests with
   * fabricated group ids.
   */
  async isGroupInScope(
    workspaceId: string,
    userId: string,
    permission: PermissionKey,
    groupId: string,
  ): Promise<boolean> {
    const grant = await this.hasPermission(workspaceId, userId, permission);
    if (!grant) return false;
    if (grant.scope === "ALL_GROUPS") return true;
    return (grant.groupIds ?? []).includes(groupId);
  }
}
