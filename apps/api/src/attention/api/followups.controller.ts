import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../../identity/api/guards/supabase-auth.guard";
import { SupabaseAuthGuard } from "../../identity/api/guards/supabase-auth.guard";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import { CurrentUser } from "../../identity/api/decorators/current-user.decorator";
import { REQUEST_ID_HEADER } from "../../common/middleware/request-id.middleware";
import { extractHeader } from "../../common/http/header-utils";
import { CurrentWorkspaceContext } from "../../team/api/decorators/current-workspace-context.decorator";
import { RequirePermission } from "../../team/api/decorators/require-permission.decorator";
import { PermissionGuard, type WorkspaceContext } from "../../team/api/guards/permission.guard";
import {
  completeFollowupRequestSchema,
  rescheduleFollowupRequestSchema,
  type FollowupActionResponse,
  type ListFollowupsResponse,
} from "@academic-precision/contracts";
import { ValidationApiException } from "../../common/exceptions/api.exception";
import { toFieldErrors } from "../../common/validation/zod-field-errors";
import { AttentionService } from "../application/attention.service";

/**
 * Thin controller — Phase 7 Scheduled Follow-up endpoints (API Contract
 * §9.7). All business/authorization logic lives in `AttentionService`.
 */
@ApiTags("followups")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PermissionGuard)
@Controller("followups")
export class FollowupsController {
  constructor(private readonly attentionService: AttentionService) {}

  @Get()
  @RequirePermission("followup.read")
  @ApiOperation({ summary: "Scheduled Follow-up queue, cursor-paginated (GET /api/v1/followups)" })
  listFollowups(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Query("status") status?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<ListFollowupsResponse> {
    return this.attentionService.listFollowups(user, workspaceContext, {
      status,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post(":id/complete")
  @RequirePermission("followup.write")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Complete a scheduled follow-up (POST /api/v1/followups/:id/complete)" })
  completeFollowup(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<FollowupActionResponse> {
    const parsed = completeFollowupRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.attentionService.completeFollowup(user, workspaceContext, id, parsed.data, extractHeader(request, REQUEST_ID_HEADER));
  }

  @Post(":id/reschedule")
  @RequirePermission("followup.write")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Move a scheduled follow-up's due date/time (POST /api/v1/followups/:id/reschedule)" })
  rescheduleFollowup(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<FollowupActionResponse> {
    const parsed = rescheduleFollowupRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.attentionService.rescheduleFollowup(user, workspaceContext, id, parsed.data, extractHeader(request, REQUEST_ID_HEADER));
  }
}
