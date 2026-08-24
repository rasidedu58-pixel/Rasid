import { Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { SupabaseAuthGuard } from "../../identity/api/guards/supabase-auth.guard";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import { CurrentUser } from "../../identity/api/decorators/current-user.decorator";
import { CurrentWorkspaceContext } from "../../team/api/decorators/current-workspace-context.decorator";
import { PermissionGuard, type WorkspaceContext } from "../../team/api/guards/permission.guard";
import type { ListNotificationsResponse, MarkAllNotificationsReadResponse, MarkNotificationReadResponse } from "@academic-precision/contracts";
import { NotificationsService } from "../application/notifications.service";

/**
 * Thin controller — Phase 9 in-app Notifications endpoints (API Contract
 * §9.10). Deliberately carry NO `@RequirePermission` decorator — "Authenticated"
 * per the registry, not gated by any catalog permission (every active
 * member sees their OWN notifications only, enforced by RLS + the explicit
 * userId scoping in `NotificationsService`) — `PermissionGuard` still
 * requires an ACTIVE membership with no decorator present, same as
 * `GET /team`/`GET /finance/collection-queue`'s own precedent.
 */
@ApiTags("notifications")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PermissionGuard)
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: "In-app notifications for the caller (GET /api/v1/notifications)" })
  list(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
  ): Promise<ListNotificationsResponse> {
    return this.notificationsService.list(user, workspaceContext);
  }

  @Post(":id/read")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Mark one notification read (POST /api/v1/notifications/:id/read)" })
  markRead(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
  ): Promise<MarkNotificationReadResponse> {
    return this.notificationsService.markRead(user, workspaceContext, id);
  }

  @Post("read-all")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Mark every unread notification read (POST /api/v1/notifications/read-all)" })
  markAllRead(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
  ): Promise<MarkAllNotificationsReadResponse> {
    return this.notificationsService.markAllRead(user, workspaceContext);
  }
}
