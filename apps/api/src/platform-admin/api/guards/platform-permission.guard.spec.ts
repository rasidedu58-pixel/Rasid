import "reflect-metadata";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { PlatformPermission, PlatformRole } from "@academic-precision/contracts";
import { ForbiddenApiException } from "../../../common/exceptions/api.exception";
import { PLATFORM_ROLE_REQUEST_KEY } from "./platform-admin.guard";
import { PLATFORM_PERMISSION_METADATA, PlatformPermissionGuard } from "./platform-permission.guard";

function makeContext(role: PlatformRole | undefined, required: PlatformPermission | undefined): ExecutionContext {
  const request: Record<string, unknown> = {};
  if (role) request[PLATFORM_ROLE_REQUEST_KEY] = role;
  const handler = () => undefined;
  if (required) Reflect.defineMetadata(PLATFORM_PERMISSION_METADATA, required, handler);
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

describe("PlatformPermissionGuard — RBAC matrix (reads + writes)", () => {
  const guard = new PlatformPermissionGuard(new Reflector());
  const allow = (role: PlatformRole, perm: PlatformPermission) => expect(guard.canActivate(makeContext(role, perm))).toBe(true);
  const deny = (role: PlatformRole, perm: PlatformPermission) => expect(() => guard.canActivate(makeContext(role, perm))).toThrow(ForbiddenApiException);

  it("allows any allowlisted admin on a route with no permission requirement", () => {
    expect(guard.canActivate(makeContext("SUPPORT_AGENT", undefined))).toBe(true);
  });

  it("forbids when no role was stashed (defensive — guard order/misuse can't bypass)", () => {
    expect(() => guard.canActivate(makeContext(undefined, "platform.support.view"))).toThrow(ForbiddenApiException);
  });

  describe("SUPPORT_AGENT — customer support data only", () => {
    it("can read + manage support, and view customers", () => {
      allow("SUPPORT_AGENT", "platform.support.view");
      allow("SUPPORT_AGENT", "platform.support.manage");
      allow("SUPPORT_AGENT", "platform.customers.view");
    });
    it("cannot see the global subscriptions list", () => deny("SUPPORT_AGENT", "platform.subscriptions.view"));
    it("cannot manage operating months", () => deny("SUPPORT_AGENT", "platform.operating_months.manage"));
    it("cannot manage staff (owner-only)", () => deny("SUPPORT_AGENT", "platform.staff.manage"));
    it("can view basic platform status, but NOT operational details", () => {
      allow("SUPPORT_AGENT", "platform.health.view");
      deny("SUPPORT_AGENT", "platform.health.details");
    });
  });

  describe("OPERATIONS_ADMIN — operations, but not owner-only security ops", () => {
    it("can view customers/subscriptions, manage support + operating months", () => {
      allow("OPERATIONS_ADMIN", "platform.customers.view");
      allow("OPERATIONS_ADMIN", "platform.subscriptions.view");
      allow("OPERATIONS_ADMIN", "platform.support.manage");
      allow("OPERATIONS_ADMIN", "platform.operating_months.manage");
    });
    it("cannot perform the owner-only staff/role management", () => deny("OPERATIONS_ADMIN", "platform.staff.manage"));
    it("can view platform health details", () => allow("OPERATIONS_ADMIN", "platform.health.details"));
  });

  describe("PLATFORM_OWNER — full surface", () => {
    it("is allowed every permission, including owner-only staff management", () => {
      allow("PLATFORM_OWNER", "platform.customers.view");
      allow("PLATFORM_OWNER", "platform.subscriptions.view");
      allow("PLATFORM_OWNER", "platform.support.manage");
      allow("PLATFORM_OWNER", "platform.operating_months.manage");
      allow("PLATFORM_OWNER", "platform.staff.manage");
    });
  });
});
