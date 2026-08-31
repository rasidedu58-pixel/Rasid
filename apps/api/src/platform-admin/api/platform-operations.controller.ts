import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type {
  FollowUp,
  ListFollowUpsResponse,
  ListMonthOverridesResponse,
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

  // --- Customer account + subscription controls -----------------------------
  @Post("workspaces/:id/account-action")
  @RequirePlatformPermission("platform.customers.manage")
  @ApiOperation({ summary: "Suspend / reactivate a customer account" })
  accountAction(@Param("id") id: string, @CurrentUser() user: VerifiedSupabaseToken, @Body() body: unknown): Promise<{ status: string }> {
    return this.service.accountAction(id, user.id, body);
  }

  @Patch("workspaces/:id/customer")
  @RequirePlatformPermission("platform.customers.manage")
  @ApiOperation({ summary: "Edit a customer's operational fields (name / owner phone)" })
  editCustomer(@Param("id") id: string, @CurrentUser() user: VerifiedSupabaseToken, @Body() body: unknown): Promise<{ name: string; ownerPhone: string | null }> {
    return this.service.editCustomer(id, user.id, body);
  }

  @Post("workspaces/:id/subscription-action")
  @RequirePlatformPermission("platform.subscriptions.manage")
  @ApiOperation({ summary: "Extend trial / set end date / suspend / reactivate a subscription" })
  subscriptionAction(@Param("id") id: string, @CurrentUser() user: VerifiedSupabaseToken, @Body() body: unknown): Promise<{ state: string; periodEnd: string | null }> {
    return this.service.subscriptionAction(id, user.id, body);
  }

  // --- Operating-Month Overrides --------------------------------------------
  @Get("workspaces/:id/operating-month-overrides")
  @RequirePlatformPermission("platform.operating_months.manage")
  @ApiOperation({ summary: "List operating-month overrides for a workspace" })
  listMonthOverrides(@Param("id") id: string): Promise<ListMonthOverridesResponse> {
    return this.service.listMonthOverrides(id);
  }

  @Post("workspaces/:id/operating-month-overrides")
  @RequirePlatformPermission("platform.operating_months.manage")
  @ApiOperation({ summary: "Grant an operating-month override (EARLY_PREP_ALLOWED / PREP_BLOCKED)" })
  createMonthOverride(@Param("id") id: string, @CurrentUser() user: VerifiedSupabaseToken, @Body() body: unknown): Promise<{ id: string }> {
    return this.service.createMonthOverride(id, user.id, body);
  }

  @Delete("operating-month-overrides/:overrideId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePlatformPermission("platform.operating_months.manage")
  @ApiOperation({ summary: "Revoke an operating-month override (never hard-deleted)" })
  async revokeMonthOverride(@Param("overrideId") overrideId: string, @CurrentUser() user: VerifiedSupabaseToken): Promise<void> {
    await this.service.revokeMonthOverride(overrideId, user.id);
  }
}
