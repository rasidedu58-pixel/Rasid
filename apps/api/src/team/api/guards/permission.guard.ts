import { CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { PermissionKey } from "@academic-precision/contracts";
import type { MembershipRow } from "@academic-precision/database";
import {
  ForbiddenApiException,
  ResourceNotFoundException,
  UnauthenticatedException,
} from "../../../common/exceptions/api.exception";
import {
  AUTH_USER_REQUEST_KEY,
  type AuthenticatedRequest,
} from "../../../identity/api/guards/supabase-auth.guard";
import { TEAM_REPOSITORY, type TeamRepositoryPort } from "../../application/ports/team-repository.port";
import { PermissionResolverService } from "../../application/permission-resolver.service";
import { REQUIRED_PERMISSION_METADATA_KEY } from "../decorators/require-permission.decorator";

export const WORKSPACE_CONTEXT_REQUEST_KEY = "workspaceContext";
export const WORKSPACE_ID_HEADER = "x-workspace-id";

export interface WorkspaceContext {
  workspaceId: string;
  membership: MembershipRow;
}

export interface WorkspaceScopedRequest extends AuthenticatedRequest {
  [WORKSPACE_CONTEXT_REQUEST_KEY]?: WorkspaceContext;
}

/**
 * Layered on top of `SupabaseAuthGuard` (must run after it in the same
 * `@UseGuards(...)` list). Resolves the workspace from the `X-Workspace-Id`
 * header (API Contract §5.1 — client-supplied header is never trusted as
 * authority by itself; the caller's active membership in that workspace is
 * always verified server-side), then checks the route's
 * `@RequirePermission(...)` key against the caller's effective permissions.
 *
 * - No membership in the header's workspace at all → safe no-leak 404
 *   (RESOURCE_NOT_FOUND), consistent with Phase 1's pattern for foreign
 *   workspace resources.
 * - Membership exists (any status) but lacks the required permission
 *   (including because it is DISABLED, which always yields zero effective
 *   permissions) → 403 FORBIDDEN — the caller IS a known member, just not
 *   permitted, no existence leak involved (API Contract §12).
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: PermissionResolverService,
    @Inject(TEAM_REPOSITORY) private readonly repository: TeamRepositoryPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.get<PermissionKey | undefined>(
      REQUIRED_PERMISSION_METADATA_KEY,
      context.getHandler(),
    );

    const request = context.switchToHttp().getRequest<WorkspaceScopedRequest>();
    const authUser = request[AUTH_USER_REQUEST_KEY];
    if (!authUser) {
      throw new UnauthenticatedException();
    }

    const headerValue = request.headers[WORKSPACE_ID_HEADER];
    const workspaceId = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (!workspaceId) {
      throw new ResourceNotFoundException();
    }

    const membership = await this.repository.findMembershipByUserAndWorkspace(authUser.id, workspaceId);
    if (!membership) {
      // Safe no-leak: identical response whether the workspace does not
      // exist or the caller has no membership in it.
      throw new ResourceNotFoundException();
    }

    if (required) {
      const grant = await this.resolver.hasPermission(workspaceId, authUser.id, required);
      if (!grant) {
        throw new ForbiddenApiException();
      }
    } else if (membership.status !== "ACTIVE") {
      // Routes with no explicit @RequirePermission (e.g. GET /team) still
      // require an active membership (Phase 2 spec §8).
      throw new ForbiddenApiException();
    }

    request[WORKSPACE_CONTEXT_REQUEST_KEY] = { workspaceId, membership };
    return true;
  }
}
