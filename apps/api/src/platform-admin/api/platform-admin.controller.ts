import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type {
  ListPlatformAdminSubscriptionsResponse,
  ListPlatformAdminUsersResponse,
  ListPlatformAdminWorkspacesResponse,
  PlatformActivityResponse,
  PlatformAdminDashboardResponse,
  PlatformAdminUserDetail,
  PlatformAdminWorkspaceDetail,
  PlatformNeedsAttentionResponse,
  PlatformOperationalSnapshot,
  PlatformRole,
  PlatformWorkspaceSubscriptionResponse,
} from "@academic-precision/contracts";
import { loadRateLimitConfig } from "../../common/rate-limit/rate-limit.config";
import { SupabaseAuthGuard } from "../../identity/api/guards/supabase-auth.guard";
import { PlatformAdminGuard } from "./guards/platform-admin.guard";
import { PlatformPermissionGuard, RequirePlatformPermission } from "./guards/platform-permission.guard";
import { CurrentPlatformRole } from "./decorators/current-platform-role.decorator";
import { PlatformAdminService } from "../application/platform-admin.service";

const RATE_LIMIT = loadRateLimitConfig();

/**
 * Rasid Platform Admin — Phase 12. Every route requires BOTH a verified
 * Supabase session (`SupabaseAuthGuard`) AND the caller's id to be in the
 * `platform_admins` allowlist (`PlatformAdminGuard`) — guard order matters
 * (auth must run first so the guard has a verified user to check). No
 * `@RequirePermission`/workspace-scoped guard is used anywhere in this
 * controller — this is deliberately NOT a tenant/workspace concept.
 * Every read is now behind a `@RequirePlatformPermission` (enforced by
 * `PlatformPermissionGuard`) — RBAC governs reads as well as writes.
 */
@ApiTags("platform-admin")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PlatformAdminGuard, PlatformPermissionGuard)
@Throttle({ default: { limit: RATE_LIMIT.platformAdmin.limit, ttl: RATE_LIMIT.platformAdmin.ttlMs } })
@Controller("platform-admin")
export class PlatformAdminController {
  constructor(private readonly service: PlatformAdminService) {}

  @Get("dashboard")
  @ApiOperation({ summary: "Platform-wide counts — no invented MRR/revenue (GET /api/v1/platform-admin/dashboard)" })
  @RequirePlatformPermission("platform.customers.view")
  getDashboard(@CurrentPlatformRole() role: PlatformRole | null): Promise<PlatformAdminDashboardResponse> {
    // Subscription counts within the dashboard are redacted for a caller
    // lacking platform.subscriptions.view (SUPPORT_AGENT).
    return this.service.getDashboard(role);
  }

  @Get("needs-attention")
  @ApiOperation({ summary: "Trials expiring soon / expired / payment-failed workspaces (GET /api/v1/platform-admin/needs-attention)" })
  @RequirePlatformPermission("platform.subscriptions.view")
  getNeedsAttention(): Promise<PlatformNeedsAttentionResponse> {
    return this.service.getNeedsAttention();
  }

  @Get("activity")
  @ApiOperation({ summary: "Recent platform operational activity — signups + subscription changes (GET /api/v1/platform-admin/activity)" })
  @RequirePlatformPermission("platform.customers.view")
  getActivity(@CurrentPlatformRole() role: PlatformRole | null): Promise<PlatformActivityResponse> {
    // Subscription-change items are redacted for a caller lacking
    // platform.subscriptions.view; customer signups remain visible.
    return this.service.getActivity(role);
  }

  @Get("workspaces/:id/operational")
  @ApiOperation({ summary: "Read-only operational snapshot / support diagnostic for one workspace (GET /api/v1/platform-admin/workspaces/:id/operational)" })
  @RequirePlatformPermission("platform.customers.view")
  getOperationalSnapshot(@Param("id") id: string): Promise<PlatformOperationalSnapshot> {
    return this.service.getOperationalSnapshot(id);
  }

  @Get("users")
  @ApiOperation({ summary: "Search/list users across every workspace (GET /api/v1/platform-admin/users)" })
  @RequirePlatformPermission("platform.customers.view")
  listUsers(
    @Query("search") search?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<ListPlatformAdminUsersResponse> {
    return this.service.listUsers({ search, cursor, limit: limit ? Number(limit) : undefined });
  }

  @Get("users/:id")
  @ApiOperation({ summary: "User detail + every membership across every workspace (GET /api/v1/platform-admin/users/:id)" })
  @RequirePlatformPermission("platform.customers.view")
  getUser(@Param("id") id: string): Promise<PlatformAdminUserDetail> {
    return this.service.getUser(id);
  }

  @Get("workspaces")
  @ApiOperation({ summary: "Search/list every Teacher Workspace (GET /api/v1/platform-admin/workspaces)" })
  @RequirePlatformPermission("platform.customers.view")
  listWorkspaces(
    @CurrentPlatformRole() role: PlatformRole | null,
    @Query("search") search?: string,
    @Query("state") state?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<ListPlatformAdminWorkspacesResponse> {
    return this.service.listWorkspaces({ search, state, cursor, limit: limit ? Number(limit) : undefined }, role);
  }

  @Get("workspaces/:id")
  @ApiOperation({ summary: "Workspace detail: owner, members, entitlements — NO subscription (GET /api/v1/platform-admin/workspaces/:id)" })
  @RequirePlatformPermission("platform.customers.view")
  getWorkspace(@Param("id") id: string): Promise<PlatformAdminWorkspaceDetail> {
    return this.service.getWorkspace(id);
  }

  @Get("workspaces/:id/subscription")
  @ApiOperation({ summary: "One workspace's subscription — sensitive billing, gated separately (GET /api/v1/platform-admin/workspaces/:id/subscription)" })
  @RequirePlatformPermission("platform.subscriptions.view")
  getWorkspaceSubscription(@Param("id") id: string): Promise<PlatformWorkspaceSubscriptionResponse> {
    return this.service.getWorkspaceSubscription(id);
  }

  @Get("subscriptions")
  @ApiOperation({ summary: "List subscriptions across every workspace, optionally filtered by state (GET /api/v1/platform-admin/subscriptions)" })
  @RequirePlatformPermission("platform.subscriptions.view")
  listSubscriptions(
    @Query("state") state?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<ListPlatformAdminSubscriptionsResponse> {
    return this.service.listSubscriptions({ state, cursor, limit: limit ? Number(limit) : undefined });
  }
}
