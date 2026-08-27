/**
 * Port (dependency-inversion boundary) used when validating that a grant's
 * `SELECTED_GROUPS` group ids belong to the same workspace as the grant's
 * target membership (Phase 2 spec §7).
 *
 * Phase 2 wired a temporary stub adapter (`AlwaysTrueGroupOwnershipAdapter`)
 * that always reported true, since no real `groups` table existed yet.
 * Phase 3 replaces that binding in `team.module.ts` with
 * `DrizzleGroupOwnershipAdapter` (`../infrastructure/group-ownership.adapter.ts`),
 * a real DB-backed check against `groups` — the port's contract
 * (`isGroupInWorkspace`) is unchanged, as is every call site.
 */
export interface GroupOwnershipPort {
  isGroupInWorkspace(groupId: string, workspaceId: string): Promise<boolean>;
  /**
   * Phase 15D.1 — batched membership check: returns the subset of `groupIds`
   * that belong to `workspaceId`, in ONE query (replaces calling
   * `isGroupInWorkspace` once per group id — a per-item N+1 on grant replace).
   * A requested id absent from the result is out-of-workspace.
   */
  findGroupIdsInWorkspace(groupIds: string[], workspaceId: string): Promise<Set<string>>;
}

export const GROUP_OWNERSHIP_PORT = Symbol("GROUP_OWNERSHIP_PORT");
