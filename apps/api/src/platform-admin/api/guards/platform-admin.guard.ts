import { CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { isPlatformAdmin } from "@academic-precision/database";
import { ForbiddenApiException, UnauthenticatedException } from "../../../common/exceptions/api.exception";
import { AUTH_USER_REQUEST_KEY, type AuthenticatedRequest } from "../../../identity/api/guards/supabase-auth.guard";

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

    const allowed = await isPlatformAdmin(authUser.id);
    if (!allowed) {
      // Same safe-no-leak posture as every other authorization boundary in
      // this codebase: a non-admin gets a plain 403, never a hint about
      // what a platform-admin route would have returned.
      throw new ForbiddenApiException();
    }

    return true;
  }
}
