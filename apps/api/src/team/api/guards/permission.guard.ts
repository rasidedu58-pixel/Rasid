import { CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { PermissionKey } from "@academic-precision/contracts";
import type { MembershipRow } from "@academic-precision/database";
import {
  AccountSuspendedException,
  ForbiddenApiException,
  ResourceNotFoundException,
  UnauthenticatedException,
} from "../../../common/exceptions/api.exception";
import {
  AUTH_USER_REQUEST_KEY,
  type AuthenticatedRequest,
} from "../../../identity/api/guards/supabase-auth.guard";
import { TEAM_REPOSITORY, type TeamRepositoryPort } from "../../application/ports/team-repository.port";
import { PermissionResolverService, type EffectiveGrant } from "../../application/permission-resolver.service";
import { REQUIRED_PERMISSION_METADATA_KEY } from "../decorators/require-permission.decorator";

export const WORKSPACE_ID_HEADER = "x-workspace-id";
export const WORKSPACE_CONTEXT_REQUEST_KEY = "workspaceContext";

export interface WorkspaceContext {
  workspaceId: string;
  membership: MembershipRow;
  /**
   * Phase 15C — the effective grant the guard already resolved for THIS
   * route's `@RequirePermission(...)` key (undefined for routes without
   * one). Hot read paths reuse it to derive their group-scope filter
   * instead of re-resolving permissions (which re-queried membership +
   * grants). It is exactly what `PermissionResolverService.hasPermission`
   * would return for that permission, so behaviour is unchanged.
   */
  grant?: EffectiveGrant;
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

    // Account-level operational hold (real backend enforcement, not a UI
    // badge): a SUSPENDED workspace can perform NO tenant operation — read or
    // write — until platform ops reactivates it. Data is untouched, so this is
    // fully reversible. Platform-admin routes are unaffected: they run behind
    // PlatformAdminGuard, never this guard. The caller is a verified member
    // (checked above), so revealing the suspension leaks nothing.
    const workspaceStatus = await this.repository.findWorkspaceStatus(workspaceId);
    if (workspaceStatus === "SUSPENDED") {
      throw new AccountSuspendedException();
    }

    let grant: EffectiveGrant | undefined;
    if (required) {
      // Phase 15C — hand the membership we just fetched to the resolver so
      // it does not re-query the same row. The resolved grant is stashed on
      // the request context for hot read paths to reuse (see WorkspaceContext).
      grant = await this.resolver.hasPermission(workspaceId, authUser.id, required, membership);
      if (!grant) {
        throw new ForbiddenApiException();
      }
    } else if (membership.status !== "ACTIVE") {
      // Routes with no explicit @RequirePermission (e.g. GET /team) still
      // require an active membership (Phase 2 spec §8).
      throw new ForbiddenApiException();
    }

    request[WORKSPACE_CONTEXT_REQUEST_KEY] = { workspaceId, membership, grant };
    return true;
  }
}
