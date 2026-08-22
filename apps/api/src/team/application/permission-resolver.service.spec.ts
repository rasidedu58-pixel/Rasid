import { PERMISSION_KEYS } from "@academic-precision/contracts";
import { InMemoryTeamRepository } from "./__fixtures__/in-memory-team.repository";
import { PermissionResolverService } from "./permission-resolver.service";

const WORKSPACE_ID = "workspace-1";

describe("PermissionResolverService", () => {
  let repository: InMemoryTeamRepository;
  let resolver: PermissionResolverService;

  beforeEach(() => {
    repository = new InMemoryTeamRepository();
    resolver = new PermissionResolverService(repository);
  });

  it("Owner has full implicit ALL_GROUPS access without any explicit permission_grants rows", async () => {
    repository.seedMembership({ id: "m-owner", workspaceId: WORKSPACE_ID, userId: "u-owner", roleLabel: "OWNER" });

    const effective = await resolver.resolveEffectivePermissions(WORKSPACE_ID, "u-owner");

    expect(effective).toHaveLength(PERMISSION_KEYS.length);
    for (const grant of effective) {
      expect(grant.scope).toBe("ALL_GROUPS");
    }
    expect(effective.map((g) => g.permission).sort()).toEqual([...PERMISSION_KEYS].sort());
  });

  it("non-owner has exactly the union+closure of their non-revoked grants", async () => {
    const membership = repository.seedMembership({
      workspaceId: WORKSPACE_ID,
      userId: "u-assistant",
      roleLabel: "ASSISTANT",
    });
    await repository.replaceMembershipGrants({
      workspaceId: WORKSPACE_ID,
      membershipId: membership.id,
      createdByUserId: "u-owner",
      desiredGrants: [{ permissionKey: "attendance.write", scopeType: "ALL_GROUPS" }],
    });

    const effective = await resolver.resolveEffectivePermissions(WORKSPACE_ID, "u-assistant");
    const keys = effective.map((g) => g.permission).sort();

    expect(keys).toEqual(["attendance.read", "attendance.write"]);
  });

  it("payments.record grant does NOT yield finance.overview in the effective set", async () => {
    const membership = repository.seedMembership({
      workspaceId: WORKSPACE_ID,
      userId: "u-assistant",
      roleLabel: "ASSISTANT",
    });
    await repository.replaceMembershipGrants({
      workspaceId: WORKSPACE_ID,
      membershipId: membership.id,
      createdByUserId: "u-owner",
      desiredGrants: [{ permissionKey: "payments.record", scopeType: "ALL_GROUPS" }],
    });

    const effective = await resolver.resolveEffectivePermissions(WORKSPACE_ID, "u-assistant");
    const keys = effective.map((g) => g.permission);

    expect(keys).toEqual(
      expect.arrayContaining(["payments.record", "payments.view_student_status", "students.view_basic"]),
    );
    expect(keys).not.toContain("finance.overview");
  });

  it.each([
    ["attendance.write", "attendance.read"],
    ["homework.write", "homework.read"],
    ["exams.write", "exams.read"],
    ["followup.write", "followup.read"],
  ] as const)("write-implies-read: %s implies %s", async (writeKey, readKey) => {
    const membership = repository.seedMembership({
      workspaceId: WORKSPACE_ID,
      userId: "u-assistant",
      roleLabel: "ASSISTANT",
    });
    await repository.replaceMembershipGrants({
      workspaceId: WORKSPACE_ID,
      membershipId: membership.id,
      createdByUserId: "u-owner",
      desiredGrants: [{ permissionKey: writeKey, scopeType: "ALL_GROUPS" }],
    });

    const effective = await resolver.resolveEffectivePermissions(WORKSPACE_ID, "u-assistant");
    expect(effective.map((g) => g.permission)).toContain(readKey);
  });

  it("a disabled membership yields zero effective permissions", async () => {
    const membership = repository.seedMembership({
      workspaceId: WORKSPACE_ID,
      userId: "u-assistant",
      roleLabel: "ASSISTANT",
    });
    await repository.replaceMembershipGrants({
      workspaceId: WORKSPACE_ID,
      membershipId: membership.id,
      createdByUserId: "u-owner",
      desiredGrants: [{ permissionKey: "attendance.write", scopeType: "ALL_GROUPS" }],
    });
    await repository.disableMembership(membership.id);

    const effective = await resolver.resolveEffectivePermissions(WORKSPACE_ID, "u-assistant");
    expect(effective).toEqual([]);
  });

  it("resolves SELECTED_GROUPS scope with the correct group id list", async () => {
    const membership = repository.seedMembership({
      workspaceId: WORKSPACE_ID,
      userId: "u-assistant",
      roleLabel: "ASSISTANT",
    });
    await repository.replaceMembershipGrants({
      workspaceId: WORKSPACE_ID,
      membershipId: membership.id,
      createdByUserId: "u-owner",
      desiredGrants: [
        { permissionKey: "students.view_basic", scopeType: "SELECTED_GROUPS", groupIds: ["group-a"] },
      ],
    });

    const inScope = await resolver.isGroupInScope(WORKSPACE_ID, "u-assistant", "students.view_basic", "group-a");
    const outOfScope = await resolver.isGroupInScope(WORKSPACE_ID, "u-assistant", "students.view_basic", "group-b");

    expect(inScope).toBe(true);
    expect(outOfScope).toBe(false);
  });
});
