import { PermissionScopeInvalidException, ResourceNotFoundException } from "../../common/exceptions/api.exception";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import type { WorkspaceContext } from "../api/guards/permission.guard";
import { FakeGroupOwnershipPort } from "./__fixtures__/fake-group-ownership.port";
import { InMemoryTeamRepository } from "./__fixtures__/in-memory-team.repository";
import { TeamService } from "./team.service";

const WORKSPACE_A = "workspace-a";
const WORKSPACE_B = "workspace-b";

describe("TeamService", () => {
  let repository: InMemoryTeamRepository;
  let groupOwnership: FakeGroupOwnershipPort;
  let service: TeamService;
  let owner: VerifiedSupabaseToken;
  let ownerMembership: ReturnType<InMemoryTeamRepository["seedMembership"]>;
  let ownerContext: WorkspaceContext;

  beforeEach(() => {
    repository = new InMemoryTeamRepository();
    groupOwnership = new FakeGroupOwnershipPort();
    service = new TeamService(repository, groupOwnership);
    owner = { id: "u-owner", email: "owner@example.com" };
    ownerMembership = repository.seedMembership({ workspaceId: WORKSPACE_A, userId: owner.id, roleLabel: "OWNER" });
    ownerContext = { workspaceId: WORKSPACE_A, membership: ownerMembership };
  });

  describe("updateMembershipPermissions", () => {
    it("rejects a team.manage grant to a non-owner membership, regardless of who requests it", async () => {
      const assistant = repository.seedMembership({
        workspaceId: WORKSPACE_A,
        userId: "u-assistant",
        roleLabel: "ASSISTANT",
      });

      await expect(
        service.updateMembershipPermissions(
          owner,
          ownerContext,
          assistant.id,
          { grants: [{ permission: "team.manage", scope: "ALL_GROUPS" }] },
          null,
        ),
      ).rejects.toBeInstanceOf(PermissionScopeInvalidException);
    });

    it("rejects a SELECTED_GROUPS grant whose group id belongs to a different workspace (422 PERMISSION_SCOPE_INVALID)", async () => {
      const assistant = repository.seedMembership({
        workspaceId: WORKSPACE_A,
        userId: "u-assistant",
        roleLabel: "ASSISTANT",
      });
      const groupInB = "11111111-1111-1111-1111-111111111111";
      groupOwnership.allow(groupInB, WORKSPACE_B); // NOT allowed for WORKSPACE_A

      await expect(
        service.updateMembershipPermissions(
          owner,
          ownerContext,
          assistant.id,
          {
            grants: [
              { permission: "students.view_basic", scope: "SELECTED_GROUPS", groupIds: [groupInB] },
            ],
          },
          null,
        ),
      ).rejects.toBeInstanceOf(PermissionScopeInvalidException);
    });

    it("accepts a SELECTED_GROUPS grant whose group id the port confirms belongs to the workspace", async () => {
      const assistant = repository.seedMembership({
        workspaceId: WORKSPACE_A,
        userId: "u-assistant",
        roleLabel: "ASSISTANT",
      });
      const groupA = "22222222-2222-2222-2222-222222222222";
      groupOwnership.allow(groupA, WORKSPACE_A);

      const result = await service.updateMembershipPermissions(
        owner,
        ownerContext,
        assistant.id,
        { grants: [{ permission: "students.view_basic", scope: "SELECTED_GROUPS", groupIds: [groupA] }] },
        "corr-1",
      );

      expect(result.permissions).toEqual([
        { permission: "students.view_basic", scope: "SELECTED_GROUPS", groupIds: [groupA] },
      ]);
    });

    it("cross-workspace: a caller cannot modify permissions of a membership belonging to a different workspace (404)", async () => {
      const foreignMembership = repository.seedMembership({
        workspaceId: WORKSPACE_B,
        userId: "u-foreign",
        roleLabel: "ASSISTANT",
      });

      await expect(
        service.updateMembershipPermissions(
          owner,
          ownerContext,
          foreignMembership.id,
          { grants: [] },
          null,
        ),
      ).rejects.toBeInstanceOf(ResourceNotFoundException);
    });

    it("writes exactly one audit_events row per call, with correct action/actor/entity", async () => {
      const assistant = repository.seedMembership({
        workspaceId: WORKSPACE_A,
        userId: "u-assistant",
        roleLabel: "ASSISTANT",
      });

      await service.updateMembershipPermissions(
        owner,
        ownerContext,
        assistant.id,
        { grants: [{ permission: "attendance.write", scope: "ALL_GROUPS" }] },
        "corr-2",
      );

      expect(repository.auditEvents).toHaveLength(1);
      const event = repository.auditEvents[0]!;
      expect(event.action).toBe("membership.permissions_updated");
      expect(event.actorUserId).toBe(owner.id);
      expect(event.actorMembershipId).toBe(ownerMembership.id);
      expect(event.entityType).toBe("membership");
      expect(event.entityId).toBe(assistant.id);
      expect(event.workspaceId).toBe(WORKSPACE_A);
      expect(event.correlationId).toBe("corr-2");
    });

    it("revokes (soft) grants removed from the desired set instead of hard-deleting them", async () => {
      const assistant = repository.seedMembership({
        workspaceId: WORKSPACE_A,
        userId: "u-assistant",
        roleLabel: "ASSISTANT",
      });

      await service.updateMembershipPermissions(
        owner,
        ownerContext,
        assistant.id,
        { grants: [{ permission: "attendance.write", scope: "ALL_GROUPS" }] },
        null,
      );
      const firstGrantId = [...repository.grantsById.values()][0]!.id;

      await service.updateMembershipPermissions(owner, ownerContext, assistant.id, { grants: [] }, null);

      // The original grant row still exists (not hard-deleted), just revoked.
      const original = repository.grantsById.get(firstGrantId);
      expect(original).toBeDefined();
      expect(original!.revokedAt).not.toBeNull();

      const active = await repository.listActiveGrants(assistant.id);
      expect(active).toEqual([]);
    });
  });

  describe("disableMembership", () => {
    it("disables a membership, blocks new actions, preserves audit/grant history, and writes one audit row", async () => {
      const assistant = repository.seedMembership({
        workspaceId: WORKSPACE_A,
        userId: "u-assistant",
        roleLabel: "ASSISTANT",
      });
      await service.updateMembershipPermissions(
        owner,
        ownerContext,
        assistant.id,
        { grants: [{ permission: "attendance.write", scope: "ALL_GROUPS" }] },
        null,
      );
      const grantAuditCountBefore = repository.auditEvents.length;

      const result = await service.disableMembership(owner, ownerContext, assistant.id, "corr-3");

      expect(result.status).toBe("DISABLED");
      expect(repository.membershipsById.get(assistant.id)!.status).toBe("DISABLED");

      // Prior audit rows untouched, new one appended.
      expect(repository.auditEvents).toHaveLength(grantAuditCountBefore + 1);
      const disableEvent = repository.auditEvents[repository.auditEvents.length - 1]!;
      expect(disableEvent.action).toBe("membership.disabled");
      expect(disableEvent.entityId).toBe(assistant.id);
      expect(disableEvent.correlationId).toBe("corr-3");

      // Grant history preserved (still queryable), just no longer active.
      const stillPresent = [...repository.grantsById.values()].some((g) => g.membershipId === assistant.id);
      expect(stillPresent).toBe(true);
    });

    it("cross-workspace: cannot disable a membership belonging to a different workspace (404)", async () => {
      const foreignMembership = repository.seedMembership({
        workspaceId: WORKSPACE_B,
        userId: "u-foreign",
        roleLabel: "ASSISTANT",
      });

      await expect(
        service.disableMembership(owner, ownerContext, foreignMembership.id, null),
      ).rejects.toBeInstanceOf(ResourceNotFoundException);
    });
  });
});
