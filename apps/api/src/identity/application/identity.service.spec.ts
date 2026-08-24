import { PERMISSION_KEYS } from "@academic-precision/contracts";
import { ForbiddenApiException, ResourceNotFoundException, ValidationApiException } from "../../common/exceptions/api.exception";
import type { VerifiedSupabaseToken } from "../infrastructure/jwt-token-verifier";
import { PermissionResolverService } from "../../team/application/permission-resolver.service";
import { InMemoryTeamRepository } from "../../team/application/__fixtures__/in-memory-team.repository";
import { InMemoryIdentityRepository } from "./__fixtures__/in-memory-identity.repository";
import { IdentityService } from "./identity.service";

const AUTH_USER: VerifiedSupabaseToken = { id: "auth-user-1", email: "teacher@example.com" };

describe("IdentityService", () => {
  let repository: InMemoryIdentityRepository;
  let teamRepository: InMemoryTeamRepository;
  let service: IdentityService;

  beforeEach(() => {
    repository = new InMemoryIdentityRepository();
    teamRepository = new InMemoryTeamRepository();
    service = new IdentityService(repository, new PermissionResolverService(teamRepository));
  });

  describe("idempotent provisioning", () => {
    it("creates exactly one user/workspace/owner-membership across repeated calls", async () => {
      const first = await service.getMe(AUTH_USER);
      const second = await service.getMe(AUTH_USER);

      expect(first.user.id).toBe(second.user.id);
      expect(first.workspaces).toHaveLength(1);
      expect(second.workspaces).toHaveLength(1);
      expect(first.workspaces[0]?.id).toBe(second.workspaces[0]?.id);
      expect(first.workspaces[0]?.roleLabel).toBe("OWNER");

      // Internal fixture state proves no duplicate was created.
      expect(repository.usersById.size).toBe(1);
      expect(repository.workspacesByUserId.size).toBe(1);
      expect(repository.membershipsByUserId.size).toBe(1);
    });
  });

  describe("getWorkspaceContext", () => {
    it("returns the §11.2 shape for an active member, including the OWNER's real full effective permission set (Phase 11 fix)", async () => {
      const me = await service.getMe(AUTH_USER);
      const workspaceId = me.workspaces[0]!.id;
      // users.id === the Supabase auth user id throughout this codebase
      // (see packages/database/src/schema/identity.ts — no DB-generated
      // default), so seeding the team-side fixture with AUTH_USER.id is
      // the same identity `resolveEffectivePermissions` will look up.
      teamRepository.seedMembership({ workspaceId, userId: AUTH_USER.id, roleLabel: "OWNER" });

      const context = await service.getWorkspaceContext(AUTH_USER, workspaceId);

      expect(context.workspace.id).toBe(workspaceId);
      expect(context.membership.roleLabel).toBe("OWNER");
      // Owner => full implicit catalog access (same resolver every write
      // endpoint's PermissionGuard uses — see PermissionResolverService).
      expect(context.permissions.sort()).toEqual([...PERMISSION_KEYS].sort());
      // Phase 8 — a freshly-provisioned workspace starts on its 14-day
      // TRIAL with every V1 capability ALLOWED.
      expect(context.subscriptionState).toBe("TRIAL");
      expect(context.entitlements.sort()).toEqual(["CORE_OPERATIONS", "CREATE_MONTH", "REPORT_EXPORT", "TEAM_MANAGEMENT"].sort());
    });

    it("returns an empty permission set when the caller has no ACTIVE membership on the team-repository side (defense-in-depth, not just an app_runtime RLS concern)", async () => {
      const me = await service.getMe(AUTH_USER);
      const workspaceId = me.workspaces[0]!.id;
      // Deliberately NOT seeding teamRepository — mirrors a real
      // desync-proof: getWorkspaceContext must never fabricate permissions
      // from the identity-side membership alone.

      const context = await service.getWorkspaceContext(AUTH_USER, workspaceId);

      expect(context.permissions).toEqual([]);
    });

    it("returns safe no-leak RESOURCE_NOT_FOUND (not FORBIDDEN) for a workspace the user is not a member of", async () => {
      await service.getMe(AUTH_USER);

      await expect(
        service.getWorkspaceContext(AUTH_USER, "some-other-workspace-id"),
      ).rejects.toBeInstanceOf(ResourceNotFoundException);
    });
  });

  describe("completeOnboarding", () => {
    it("422s when unifiedDueDay is missing and dueDatePolicy is UNIFIED", async () => {
      await service.getMe(AUTH_USER);

      await expect(
        service.completeOnboarding(AUTH_USER, {
          displayName: "أ. محمد",
          dueDatePolicy: "UNIFIED",
        }),
      ).rejects.toBeInstanceOf(ValidationApiException);
    });

    it("422s when unifiedDueDay is present and dueDatePolicy is PER_GROUP", async () => {
      await service.getMe(AUTH_USER);

      await expect(
        service.completeOnboarding(AUTH_USER, {
          displayName: "أ. محمد",
          dueDatePolicy: "PER_GROUP",
          unifiedDueDay: 5,
        }),
      ).rejects.toBeInstanceOf(ValidationApiException);
    });

    it("succeeds with unifiedDueDay when dueDatePolicy is UNIFIED", async () => {
      await service.getMe(AUTH_USER);

      const result = await service.completeOnboarding(AUTH_USER, {
        displayName: "أ. محمد",
        dueDatePolicy: "UNIFIED",
        unifiedDueDay: 10,
      });

      expect(result.workspace.dueDatePolicy).toBe("UNIFIED");
      expect(result.workspace.unifiedDueDay).toBe(10);
      expect(result.workspace.name).toBe("أ. محمد");
    });

    it("403s when the caller's membership is not OWNER", async () => {
      const nonOwner: VerifiedSupabaseToken = { id: "auth-user-2", email: "assistant@example.com" };
      repository.seedMembership(nonOwner.id, { roleLabel: "ASSISTANT" });

      await expect(
        service.completeOnboarding(nonOwner, {
          displayName: "مساعد",
          dueDatePolicy: "PER_GROUP",
        }),
      ).rejects.toBeInstanceOf(ForbiddenApiException);
    });
  });
});
