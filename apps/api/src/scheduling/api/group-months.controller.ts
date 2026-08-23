import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
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
  groupMonthApplyChangeRequestSchema,
  groupMonthChangePreviewRequestSchema,
  schedulePreviewRequestSchema,
  scheduleApplyRequestSchema,
  type GroupMonth,
  type GroupMonthApplyChangeRequest,
  type GroupMonthApplyChangeResponse,
  type GroupMonthChangePreviewRequest,
  type GroupMonthChangePreviewResponse,
  type ListScheduleRulesResponse,
  type ScheduleApplyRequest,
  type ScheduleApplyResponse,
  type SchedulePreviewRequest,
  type SchedulePreviewResponse,
} from "@academic-precision/contracts";
import { ValidationApiException } from "../../common/exceptions/api.exception";
import { toFieldErrors } from "../../common/validation/zod-field-errors";
import { SchedulingService } from "../application/scheduling.service";

/**
 * Thin controller — Phase 3 GroupMonth + Schedule endpoints (API Contract
 * §9.3). All business/authorization logic lives in `SchedulingService`,
 * including the per-group scope check (`groups.view`/`groups.manage`/
 * `sessions.manage` catalog permission + `isGroupInScope`).
 */
@ApiTags("group-months")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PermissionGuard)
@Controller("group-months")
export class GroupMonthsController {
  constructor(private readonly schedulingService: SchedulingService) {}

  @Get(":id")
  @RequirePermission("groups.view")
  @ApiOperation({ summary: "GroupMonth (monthly config) details (GET /api/v1/group-months/:id)" })
  getGroupMonth(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
  ): Promise<GroupMonth> {
    return this.schedulingService.getGroupMonth(user, workspaceContext, id);
  }

  @Post(":id/change-preview")
  @RequirePermission("groups.manage")
  @ApiOperation({ summary: "Field-diff impact preview for a GroupMonth change (POST .../change-preview)" })
  previewChange(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<GroupMonthChangePreviewResponse> {
    const parsed = groupMonthChangePreviewRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.schedulingService.previewGroupMonthChange(
      user,
      workspaceContext,
      id,
      parsed.data as GroupMonthChangePreviewRequest,
    );
  }

  @Post(":id/apply-change")
  @RequirePermission("groups.manage")
  @ApiOperation({ summary: "Apply an approved GroupMonth change (POST .../apply-change)" })
  applyChange(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<GroupMonthApplyChangeResponse> {
    const parsed = groupMonthApplyChangeRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.schedulingService.applyGroupMonthChange(
      user,
      workspaceContext,
      id,
      parsed.data as GroupMonthApplyChangeRequest,
      extractHeader(request, REQUEST_ID_HEADER),
    );
  }

  @Get(":id/schedule")
  @RequirePermission("groups.view")
  @ApiOperation({ summary: "Current schedule rules for a GroupMonth (GET .../schedule)" })
  listSchedule(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
  ): Promise<ListScheduleRulesResponse> {
    return this.schedulingService.listScheduleRules(user, workspaceContext, id);
  }

  @Post(":id/schedule/preview")
  @RequirePermission("sessions.manage")
  @ApiOperation({
    summary:
      "Future session impact of proposed schedule rules; also the initial-creation path for a group with no rules yet (POST .../schedule/preview)",
  })
  previewSchedule(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<SchedulePreviewResponse> {
    const parsed = schedulePreviewRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.schedulingService.previewSchedule(user, workspaceContext, id, parsed.data as SchedulePreviewRequest);
  }

  @Post(":id/schedule/apply")
  @RequirePermission("sessions.manage")
  @ApiOperation({ summary: "Apply a previewed schedule change (POST .../schedule/apply)" })
  applySchedule(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ScheduleApplyResponse> {
    const parsed = scheduleApplyRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.schedulingService.applySchedule(
      user,
      workspaceContext,
      id,
      parsed.data as ScheduleApplyRequest,
      extractHeader(request, REQUEST_ID_HEADER),
    );
  }
}
