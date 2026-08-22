/**
 * Port (dependency-inversion boundary) used when validating that a grant's
 * `SELECTED_GROUPS` group ids belong to the same workspace as the grant's
 * target membership (Phase 2 spec §7).
 *
 * No real `groups` table exists yet (Phase 3 builds it), so Phase 2 wires a
 * temporary stub adapter (`AlwaysTrueGroupOwnershipAdapter`, in
 * `../infrastructure/stub-group-ownership.adapter.ts`) that always reports
 * true. The validation *call site* (`TeamService.updateMembershipPermissions`)
 * exists and is exercised regardless — Phase 3 replaces only the adapter
 * bound to this port (a real DB-backed check against `groups`), without
 * changing the port's contract or any call site.
 */
export interface GroupOwnershipPort {
  isGroupInWorkspace(groupId: string, workspaceId: string): Promise<boolean>;
}

export const GROUP_OWNERSHIP_PORT = Symbol("GROUP_OWNERSHIP_PORT");
