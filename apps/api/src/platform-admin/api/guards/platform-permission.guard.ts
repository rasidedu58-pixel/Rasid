import { CanActivate, type ExecutionContext, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { hasPlatformPermission, type PlatformPermission, type PlatformRole } from "@academic-precision/contracts";
import { ForbiddenApiException } from "../../../common/exceptions/api.exception";
import { PLATFORM_ROLE_REQUEST_KEY } from "./platform-admin.guard";

export const PLATFORM_PERMISSION_METADATA = "platform:permission";

/**
 * Marks a platform-admin route as requiring a specific platform permission.
 * `PlatformAdminGuard` must run first (it stashes the caller's role); this
 * guard then checks the role→permission map. Routes WITHOUT this decorator
 * remain accessible to any allowlisted platform admin (all read endpoints).
 */
export const RequirePlatformPermission = (permission: PlatformPermission) =>
  SetMetadata(PLATFORM_PERMISSION_METADATA, permission);

@Injectable()
export class PlatformPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PlatformPermission | undefined>(PLATFORM_PERMISSION_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    // No permission requirement on this route → any allowlisted admin passes.
    if (!required) return true;

    const request = context.switchToHttp().getRequest<{ [PLATFORM_ROLE_REQUEST_KEY]?: PlatformRole }>();
    const role = request[PLATFORM_ROLE_REQUEST_KEY] ?? null;
    if (!hasPlatformPermission(role, required)) {
      // Safe-no-leak: an under-privileged staff member gets a plain 403.
      throw new ForbiddenApiException();
    }
    return true;
  }
}
