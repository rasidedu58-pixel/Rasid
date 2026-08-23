import { CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Capability } from "@academic-precision/database";
import { EntitlementBlockedException, SubscriptionRequiredException, UnauthenticatedException } from "../../../common/exceptions/api.exception";
import { WORKSPACE_CONTEXT_REQUEST_KEY, type WorkspaceScopedRequest } from "../../../team/api/guards/permission.guard";
import { ENTITLEMENT_REPOSITORY, type EntitlementRepositoryPort } from "../../application/ports/entitlement-repository.port";
import { REQUIRED_ENTITLEMENT_METADATA_KEY } from "../decorators/require-entitlement.decorator";

/**
 * MUST run AFTER `PermissionGuard` in the same `@UseGuards(...)` list (it
 * reads `request[WORKSPACE_CONTEXT_REQUEST_KEY]`, populated by
 * `PermissionGuard`) — mirrors that guard's own structure exactly. A route
 * with no `@RequireEntitlement(...)` passes through untouched: Entitlement
 * gates only the routes the approved Entitlement Matrix actually names
 * (§ Permissions vs Entitlements correction — historical reads and
 * `/billing/*` never carry this decorator at all).
 *
 * Fail-CLOSED: no current entitlement row for the capability (should never
 * happen once a workspace is provisioned, but a missing row is a data gap,
 * not a green light) is treated exactly like BLOCKED.
 *
 * `REPORT_EXPORT` → `ENTITLEMENT_BLOCKED` (a feature-specific gate);
 * every other V1 capability → `SUBSCRIPTION_REQUIRED` (the workspace's
 * subscription itself is what's blocking the action) — matches the two
 * distinct API Contract §12 error codes' apparent intents.
 */
@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ENTITLEMENT_REPOSITORY) private readonly repository: EntitlementRepositoryPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.get<Capability | undefined>(REQUIRED_ENTITLEMENT_METADATA_KEY, context.getHandler());
    if (!required) return true;

    const request = context.switchToHttp().getRequest<WorkspaceScopedRequest>();
    const workspaceContext = request[WORKSPACE_CONTEXT_REQUEST_KEY];
    if (!workspaceContext) {
      // PermissionGuard did not run first, or found no membership (which
      // would already have thrown) — this is a wiring bug, not a normal
      // 403/404 path.
      throw new UnauthenticatedException();
    }

    const state = await this.repository.findCurrentEntitlementState(workspaceContext.workspaceId, required);
    if (state !== "ALLOWED") {
      if (required === "REPORT_EXPORT") throw new EntitlementBlockedException();
      throw new SubscriptionRequiredException();
    }

    return true;
  }
}
