import { Injectable } from "@nestjs/common";
import type { GroupOwnershipPort } from "../application/ports/group-ownership.port";

/**
 * TEMPORARY Phase 2 stub — no real `groups` table exists yet (Phase 3
 * builds it). Always reports that a group belongs to the workspace, so the
 * Phase 2 mechanism (the `GroupOwnershipPort` call site in
 * `TeamService.updateMembershipPermissions`) is provably wired end to end
 * without a real Groups resource to check against.
 *
 * Phase 3 MUST replace this binding (in `team.module.ts`) with a real
 * DB-backed implementation that queries the `groups` table — the port's
 * contract (`isGroupInWorkspace`) does not change.
 */
@Injectable()
export class AlwaysTrueGroupOwnershipAdapter implements GroupOwnershipPort {
  isGroupInWorkspace(_groupId: string, _workspaceId: string): Promise<boolean> {
    return Promise.resolve(true);
  }
}
