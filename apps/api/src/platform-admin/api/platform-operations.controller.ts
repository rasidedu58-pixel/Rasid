import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type {
  FollowUp,
  ListFollowUpsResponse,
  ListPlatformContactLogsResponse,
  ListPlatformStaffResponse,
  PlatformContactLog,
} from "@academic-precision/contracts";
import { loadRateLimitConfig } from "../../common/rate-limit/rate-limit.config";
import { CurrentUser } from "../../identity/api/decorators/current-user.decorator";
import { SupabaseAuthGuard } from "../../identity/api/guards/supabase-auth.guard";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import { PlatformAdminGuard } from "./guards/platform-admin.guard";
import { PlatformPermissionGuard, RequirePlatformPermission } from "./guards/platform-permission.guard";
import { PlatformOperationsService } from "../application/platform-operations.service";

const RATE_LIMIT = loadRateLimitConfig();

/**
 * Platform Operations — Unit 1 (Customer Communication + Follow-up) WRITE
 * endpoints. Same outer gate as the read console (`SupabaseAuthGuard` +
 * `PlatformAdminGuard`), plus `PlatformPermissionGuard` which enforces the
 * per-route `@RequirePlatformPermission` against the caller's platform role.
 */
@ApiTags("platform-admin")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PlatformAdminGuard, PlatformPermissionGuard)
@Throttle({ default: { limit: RATE_LIMIT.platformAdmin.limit, ttl: RATE_LIMIT.platformAdmin.ttlMs } })
@Controller("platform-admin")
export class PlatformOperationsController {
  constructor(private readonly service: PlatformOperationsService) {}

  // --- Contact logs ---------------------------------------------------------
  @Get("workspaces/:id/contact-logs")
  @RequirePlatformPermission("platform.support.view")
  @ApiOperation({ summary: "List customer contact logs for a workspace" })
  listContactLogs(
    @Param("id") id: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<ListPlatformContactLogsResponse> {
    return this.service.listContactLogs(id, cursor, limit ? Number(limit) : undefined);
  }

  @Post("workspaces/:id/contact-logs")
  @RequirePlatformPermission("platform.support.manage")
  @ApiOperation({ summary: "Record a customer contact log against a workspace" })
  createContactLog(@Param("id") id: string, @CurrentUser() user: VerifiedSupabaseToken, @Body() body: unknown): Promise<PlatformContactLog> {
    return this.service.createContactLog(id, user.id, body);
  }

  // --- Follow-ups -----------------------------------------------------------
  @Get("follow-ups")
  @RequirePlatformPermission("platform.support.view")
  @ApiOperation({ summary: "Follow-up queue across all customers (filter by status / assignee)" })
  listFollowUps(
    @Query("status") status?: string,
    @Query("assignedToUserId") assignedToUserId?: string,
    @Query("workspaceId") workspaceId?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<ListFollowUpsResponse> {
    return this.service.listFollowUps({ status, assignedToUserId, workspaceId, cursor, limit: limit ? Number(limit) : undefined });
  }

  @Get("workspaces/:id/follow-ups")
  @RequirePlatformPermission("platform.support.view")
  @ApiOperation({ summary: "Follow-ups for one workspace" })
  listWorkspaceFollowUps(
    @Param("id") id: string,
    @Query("status") status?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<ListFollowUpsResponse> {
    return this.service.listFollowUps({ workspaceId: id, status, cursor, limit: limit ? Number(limit) : undefined });
  }

  @Post("workspaces/:id/follow-ups")
  @RequirePlatformPermission("platform.support.manage")
  @ApiOperation({ summary: "Queue a follow-up against a workspace" })
  createFollowUp(@Param("id") id: string, @CurrentUser() user: VerifiedSupabaseToken, @Body() body: unknown): Promise<FollowUp> {
    return this.service.createFollowUp(id, user.id, body);
  }

  @Patch("follow-ups/:followUpId")
  @RequirePlatformPermission("platform.support.manage")
  @ApiOperation({ summary: "Resolve / cancel / reassign / reschedule a follow-up" })
  updateFollowUp(@Param("followUpId") followUpId: string, @CurrentUser() user: VerifiedSupabaseToken, @Body() body: unknown): Promise<FollowUp> {
    return this.service.updateFollowUp(followUpId, user.id, body);
  }

  // --- Staff (assignment picker + role display) -----------------------------
  @Get("staff")
  @RequirePlatformPermission("platform.support.view")
  @ApiOperation({ summary: "List platform staff (for follow-up assignment)" })
  listStaff(): Promise<ListPlatformStaffResponse> {
    return this.service.listStaff();
  }
}
