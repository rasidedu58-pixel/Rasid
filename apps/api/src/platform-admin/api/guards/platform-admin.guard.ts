import { CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { getPlatformAdminRole } from "@academic-precision/database";
import type { PlatformRole } from "@academic-precision/contracts";
import { ForbiddenApiException, UnauthenticatedException } from "../../../common/exceptions/api.exception";
import { AUTH_USER_REQUEST_KEY, type AuthenticatedRequest } from "../../../identity/api/guards/supabase-auth.guard";

/**
 * Request key under which `PlatformAdminGuard` stashes the verified caller's
 * platform role, so a following `PlatformPermissionGuard` can authorize a
 * specific write without a second DB read.
 */
export const PLATFORM_ROLE_REQUEST_KEY = "platformRole" as const;

/**
 * The ONE gate every platform-admin route sits behind, in addition to
 * `SupabaseAuthGuard` (which must run first — see the `@UseGuards` order
 * on `PlatformAdminController`). Deliberately NOT workspace-membership-
 * based: checks the verified caller's id against the `platform_admins`
 * allowlist table only (see `packages/database/src/schema/platform-
 * admin.ts`'s own comment for why). No workspace Owner, however
 * privileged within their own tenant, can ever pass this check — there is
 * no code path from "OWNER role_label" to "platform admin" anywhere.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authUser = request[AUTH_USER_REQUEST_KEY];
    if (!authUser) {
      throw new UnauthenticatedException();
    }

    const role = await getPlatformAdminRole(authUser.id);
    if (!role) {
      // Same safe-no-leak posture as every other authorization boundary in
      // this codebase: a non-admin gets a plain 403, never a hint about
      // what a platform-admin route would have returned.
      throw new ForbiddenApiException();
    }

    // Stash the role for a following PlatformPermissionGuard (write routes).
    (request as AuthenticatedRequest & { [PLATFORM_ROLE_REQUEST_KEY]?: PlatformRole })[PLATFORM_ROLE_REQUEST_KEY] = role;
    return true;
  }
}
