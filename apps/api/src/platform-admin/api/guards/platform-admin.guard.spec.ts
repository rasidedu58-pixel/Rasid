import "reflect-metadata";
import type { ExecutionContext } from "@nestjs/common";
import { ForbiddenApiException, UnauthenticatedException } from "../../../common/exceptions/api.exception";
import { AUTH_USER_REQUEST_KEY } from "../../../identity/api/guards/supabase-auth.guard";
import { PlatformAdminGuard, PLATFORM_ROLE_REQUEST_KEY } from "./platform-admin.guard";

const getPlatformAdminRoleMock = jest.fn();

jest.mock("@academic-precision/database", () => ({
  getPlatformAdminRole: (userId: string) => getPlatformAdminRoleMock(userId),
}));

function makeContext(authUserId?: string): { context: ExecutionContext; request: Record<string, unknown> } {
  const request: Record<string, unknown> = {};
  if (authUserId) request[AUTH_USER_REQUEST_KEY] = { id: authUserId, email: null };
  return {
    request,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext,
  };
}

describe("PlatformAdminGuard", () => {
  let guard: PlatformAdminGuard;

  beforeEach(() => {
    guard = new PlatformAdminGuard();
    getPlatformAdminRoleMock.mockReset();
  });

  it("rejects (UNAUTHENTICATED) when no verified user is on the request at all", async () => {
    await expect(guard.canActivate(makeContext().context)).rejects.toBeInstanceOf(UnauthenticatedException);
    expect(getPlatformAdminRoleMock).not.toHaveBeenCalled();
  });

  it("rejects (FORBIDDEN, safe no-leak) a verified but non-platform-admin caller — e.g. an ordinary Workspace Owner", async () => {
    getPlatformAdminRoleMock.mockResolvedValue(null);
    await expect(guard.canActivate(makeContext("u-ordinary-owner").context)).rejects.toBeInstanceOf(ForbiddenApiException);
    expect(getPlatformAdminRoleMock).toHaveBeenCalledWith("u-ordinary-owner");
  });

  it("allows a verified allowlisted caller and stashes their role on the request", async () => {
    getPlatformAdminRoleMock.mockResolvedValue("OPERATIONS_ADMIN");
    const { context, request } = makeContext("u-platform-admin");
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request[PLATFORM_ROLE_REQUEST_KEY]).toBe("OPERATIONS_ADMIN");
  });
});
