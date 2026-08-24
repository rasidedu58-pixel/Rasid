import "reflect-metadata";
import type { ExecutionContext } from "@nestjs/common";
import { ForbiddenApiException, UnauthenticatedException } from "../../../common/exceptions/api.exception";
import { AUTH_USER_REQUEST_KEY } from "../../../identity/api/guards/supabase-auth.guard";
import { PlatformAdminGuard } from "./platform-admin.guard";

const isPlatformAdminMock = jest.fn();

jest.mock("@academic-precision/database", () => ({
  isPlatformAdmin: (userId: string) => isPlatformAdminMock(userId),
}));

function makeContext(authUserId?: string): ExecutionContext {
  const request: Record<string, unknown> = {};
  if (authUserId) request[AUTH_USER_REQUEST_KEY] = { id: authUserId, email: null };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe("PlatformAdminGuard", () => {
  let guard: PlatformAdminGuard;

  beforeEach(() => {
    guard = new PlatformAdminGuard();
    isPlatformAdminMock.mockReset();
  });

  it("rejects (UNAUTHENTICATED) when no verified user is on the request at all", async () => {
    await expect(guard.canActivate(makeContext())).rejects.toBeInstanceOf(UnauthenticatedException);
    expect(isPlatformAdminMock).not.toHaveBeenCalled();
  });

  it("rejects (FORBIDDEN, safe no-leak) a verified but non-platform-admin caller — e.g. an ordinary Workspace Owner", async () => {
    isPlatformAdminMock.mockResolvedValue(false);
    await expect(guard.canActivate(makeContext("u-ordinary-owner"))).rejects.toBeInstanceOf(ForbiddenApiException);
    expect(isPlatformAdminMock).toHaveBeenCalledWith("u-ordinary-owner");
  });

  it("allows a verified caller whose id is in the platform_admins allowlist", async () => {
    isPlatformAdminMock.mockResolvedValue(true);
    await expect(guard.canActivate(makeContext("u-platform-admin"))).resolves.toBe(true);
  });
});
