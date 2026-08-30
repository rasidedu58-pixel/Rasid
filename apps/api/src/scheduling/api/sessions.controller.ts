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
import { EntitlementGuard } from "../../billing/api/guards/entitlement.guard";
import { RequireEntitlement } from "../../billing/api/decorators/require-entitlement.decorator";
import {
  sessionRescheduleRequestSchema,
  sessionReschedulePreviewRequestSchema,
  type ListSessionsResponse,
  type ListSessionsCalendarResponse,
  type Session,
  type SessionCancelResponse,
  type SessionReschedulePreviewRequest,
  type SessionReschedulePreviewResponse,
  type SessionRescheduleRequest,
  type SessionRescheduleResponse,
} from "@academic-precision/contracts";
import { ValidationApiException } from "../../common/exceptions/api.exception";
import { toFieldErrors } from "../../common/validation/zod-field-errors";
import { SchedulingService } from "../application/scheduling.service";

/**
 * Thin controller — Phase 3 Sessions endpoints (API Contract §9.4), ONLY
 * cancel/reschedule-preview/reschedule/list/detail. start/roster/
 * attendance/homework/exam/review/complete are explicitly out of Phase 3
 * scope (Phase 5).
 */
@ApiTags("sessions")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PermissionGuard)
@Controller("sessions")
export class SessionsController {
  constructor(private readonly schedulingService: SchedulingService) {}

  @Get()
  @RequirePermission("groups.view")
  @ApiOperation({ summary: "Filtered sessions, cursor-paginated (GET /api/v1/sessions)" })
  listSessions(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Query("groupMonthId") groupMonthId?: string,
    @Query("status") status?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<ListSessionsResponse> {
    return this.schedulingService.listSessions(user, workspaceContext, {
      groupMonthId,
      status,
      from,
      to,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get("calendar")
  @RequirePermission("groups.view")
  @ApiOperation({ summary: "Enriched sessions in a date range for the calendar (GET /api/v1/sessions/calendar)" })
  listSessionsCalendar(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ): Promise<ListSessionsCalendarResponse> {
    return this.schedulingService.listSessionsCalendar(user, workspaceContext, { from, to });
  }

  @Get(":id")
  @RequirePermission("groups.view")
  @ApiOperation({ summary: "Session detail (GET /api/v1/sessions/:id)" })
  getSession(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
  ): Promise<Session> {
    return this.schedulingService.getSession(user, workspaceContext, id);
  }

  @Post(":id/cancel")
  @RequirePermission("sessions.manage")
  @UseGuards(EntitlementGuard)
  @RequireEntitlement("CORE_OPERATIONS")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Cancel an eligible (SCHEDULED) session (POST /api/v1/sessions/:id/cancel)" })
  cancelSession(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<SessionCancelResponse> {
    return this.schedulingService.cancelSession(user, workspaceContext, id, extractHeader(request, REQUEST_ID_HEADER));
  }

  @Post(":id/reschedule-preview")
  @RequirePermission("sessions.manage")
  @ApiOperation({ summary: "Preview a reschedule replacement (POST /api/v1/sessions/:id/reschedule-preview)" })
  reschedulePreview(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<SessionReschedulePreviewResponse> {
    const parsed = sessionReschedulePreviewRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.schedulingService.reschedulePreviewSession(
      user,
      workspaceContext,
      id,
      parsed.data as SessionReschedulePreviewRequest,
    );
  }

  @Post(":id/reschedule")
  @RequirePermission("sessions.manage")
  @UseGuards(EntitlementGuard)
  @RequireEntitlement("CORE_OPERATIONS")
  @ApiOperation({ summary: "Create one linked replacement session (POST /api/v1/sessions/:id/reschedule)" })
  reschedule(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<SessionRescheduleResponse> {
    const parsed = sessionRescheduleRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.schedulingService.rescheduleSession(
      user,
      workspaceContext,
      id,
      parsed.data as SessionRescheduleRequest,
      extractHeader(request, REQUEST_ID_HEADER),
    );
  }
}
