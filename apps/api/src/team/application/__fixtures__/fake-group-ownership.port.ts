import type { GroupOwnershipPort } from "../ports/group-ownership.port";

/**
 * Test double for {@link GroupOwnershipPort} whose behavior is controlled
 * by the test: an allow-list of `${groupId}:${workspaceId}` pairs that are
 * considered "in workspace". Any pair not in the allow-list is reported as
 * NOT belonging to the workspace — used to exercise the
 * `PERMISSION_SCOPE_INVALID` reject path (Phase 2 spec §7).
 */
export class FakeGroupOwnershipPort implements GroupOwnershipPort {
  private readonly allowed = new Set<string>();

  allow(groupId: string, workspaceId: string): this {
    this.allowed.add(`${groupId}:${workspaceId}`);
    return this;
  }

  async isGroupInWorkspace(groupId: string, workspaceId: string): Promise<boolean> {
    return this.allowed.has(`${groupId}:${workspaceId}`);
  }
}
