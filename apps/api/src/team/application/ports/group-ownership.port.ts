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
}

export const GROUP_OWNERSHIP_PORT = Symbol("GROUP_OWNERSHIP_PORT");
