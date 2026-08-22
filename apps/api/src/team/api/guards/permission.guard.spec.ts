import "reflect-metadata";
import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { ForbiddenApiException, ResourceNotFoundException } from "../../../common/exceptions/api.exception";
import { AUTH_USER_REQUEST_KEY } from "../../../identity/api/guards/supabase-auth.guard";
import { InMemoryTeamRepository } from "../../application/__fixtures__/in-memory-team.repository";
import { PermissionResolverService } from "../../application/permission-resolver.service";
import { REQUIRED_PERMISSION_METADATA_KEY } from "../decorators/require-permission.decorator";
import { PermissionGuard, WORKSPACE_ID_HEADER } from "./permission.guard";

const WORKSPACE_A = "workspace-a";
const WORKSPACE_B = "workspace-b";

function makeContext(options: {
  authUserId?: string;
  workspaceHeader?: string;
  requiredPermission?: string;
}): ExecutionContext {
  const handler = () => undefined;
  if (options.requiredPermission) {
    Reflect.defineMetadata(REQUIRED_PERMISSION_METADATA_KEY, options.requiredPermission, handler);
  }
  const request: Record<string, unknown> = {
    headers: options.workspaceHeader ? { [WORKSPACE_ID_HEADER]: options.workspaceHeader } : {},
  };
  if (options.authUserId) {
    request[AUTH_USER_REQUEST_KEY] = { id: options.authUserId, email: null };
  }
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
  } as unknown as ExecutionContext;
}

describe("PermissionGuard", () => {
  let repository: InMemoryTeamRepository;
  let resolver: PermissionResolverService;
  let guard: PermissionGuard;

  beforeEach(() => {
    repository = new InMemoryTeamRepository();
    resolver = new PermissionResolverService(repository);
    guard = new PermissionGuard(new Reflector(), resolver, repository);
  });

  it("404s (RESOURCE_NOT_FOUND) when the caller has no membership in the header's workspace", async () => {
    const context = makeContext({ authUserId: "u-1", workspaceHeader: WORKSPACE_A });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ResourceNotFoundException);
  });

  it("403s (FORBIDDEN) when the caller is a member but lacks the required permission", async () => {
    repository.seedMembership({ workspaceId: WORKSPACE_A, userId: "u-1", roleLabel: "ASSISTANT" });
    const context = makeContext({
      authUserId: "u-1",
      workspaceHeader: WORKSPACE_A,
      requiredPermission: "team.manage",
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenApiException);
  });

  it("allows the Owner through a team.manage-required route", async () => {
    repository.seedMembership({ workspaceId: WORKSPACE_A, userId: "u-owner", roleLabel: "OWNER" });
    const context = makeContext({
      authUserId: "u-owner",
      workspaceHeader: WORKSPACE_A,
      requiredPermission: "team.manage",
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("403s a DISABLED member even on a route with no explicit @RequirePermission", async () => {
    repository.seedMembership({
      workspaceId: WORKSPACE_A,
      userId: "u-1",
      roleLabel: "ASSISTANT",
      status: "DISABLED",
    });
    const context = makeContext({ authUserId: "u-1", workspaceHeader: WORKSPACE_A });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenApiException);
  });

  it("does not leak workspace B's membership existence to a caller only scoped to workspace A", async () => {
    repository.seedMembership({ workspaceId: WORKSPACE_A, userId: "u-1", roleLabel: "ASSISTANT" });
    repository.seedMembership({ workspaceId: WORKSPACE_B, userId: "u-2", roleLabel: "OWNER" });
    const context = makeContext({ authUserId: "u-1", workspaceHeader: WORKSPACE_B });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ResourceNotFoundException);
  });
});
