import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { SupabaseAuthGuard } from "../../identity/api/guards/supabase-auth.guard";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import { CurrentUser } from "../../identity/api/decorators/current-user.decorator";
import { CurrentWorkspaceContext } from "../../team/api/decorators/current-workspace-context.decorator";
import { PermissionGuard, type WorkspaceContext } from "../../team/api/guards/permission.guard";
import type { ActionCenterResponse } from "@academic-precision/contracts";
import { ActionCenterService } from "../application/action-center.service";

/**
 * Thin controller — `GET /action-center` (API Contract §9.10, §17).
 * Deliberately NO `@RequirePermission` decorator on the ROUTE itself — per
 * the Phase 9 Closure correction, authorization is per-SECTION, resolved
 * entirely inside `ActionCenterService`. `PermissionGuard` still requires
 * an ACTIVE membership with no decorator present, same as
 * `GET /finance/collection-queue`'s own precedent.
 */
@ApiTags("action-center")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PermissionGuard)
@Controller("action-center")
export class ActionCenterController {
  constructor(private readonly actionCenterService: ActionCenterService) {}

  @Get()
  @ApiOperation({ summary: "Aggregated operational read model (GET /api/v1/action-center)" })
  get(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
  ): Promise<ActionCenterResponse> {
    return this.actionCenterService.getActionCenter(user, workspaceContext);
  }
}
