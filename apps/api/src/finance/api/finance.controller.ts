import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { SupabaseAuthGuard } from "../../identity/api/guards/supabase-auth.guard";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import { CurrentUser } from "../../identity/api/decorators/current-user.decorator";
import { CurrentWorkspaceContext } from "../../team/api/decorators/current-workspace-context.decorator";
import { RequirePermission } from "../../team/api/decorators/require-permission.decorator";
import { PermissionGuard, type WorkspaceContext } from "../../team/api/guards/permission.guard";
import type { CollectionQueueResponse, FinanceSummaryResponse } from "@academic-precision/contracts";
import { FinanceService } from "../application/finance.service";

/**
 * Thin controller — Phase 6 `/finance/*` endpoints (API Contract §9.6).
 * `collection-queue` deliberately carries NO `@RequirePermission` decorator
 * — its permission is "payments.view_student_status OR finance.overview"
 * (the registry's own wording), which `PermissionGuard`'s single-key
 * decorator can't express; `FinanceService.getCollectionQueue` performs the
 * actual OR-permission check itself (PermissionGuard still requires an
 * active membership with no decorator present, same as Phase 2's `GET
 * /team`).
 */
@ApiTags("finance")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PermissionGuard)
@Controller("finance")
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get("collection-queue")
  @ApiOperation({ summary: "Due/remaining queue (GET /api/v1/finance/collection-queue)" })
  @ApiQuery({ name: "cursor", required: false, description: "Opaque pagination cursor from a previous page's nextCursor." })
  collectionQueue(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Query("cursor") cursor?: string,
  ): Promise<CollectionQueueResponse> {
    return this.financeService.getCollectionQueue(user, workspaceContext, { cursor });
  }

  @Get("summary")
  @RequirePermission("finance.overview")
  @ApiOperation({ summary: "Workspace/group scoped summary (GET /api/v1/finance/summary)" })
  summary(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
  ): Promise<FinanceSummaryResponse> {
    return this.financeService.getFinanceSummary(user, workspaceContext);
  }
}
