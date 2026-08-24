import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type {
  ListPlatformAdminSubscriptionsResponse,
  ListPlatformAdminUsersResponse,
  ListPlatformAdminWorkspacesResponse,
  PlatformAdminDashboardResponse,
  PlatformAdminUserDetail,
  PlatformAdminWorkspaceDetail,
} from "@academic-precision/contracts";
import { loadRateLimitConfig } from "../../common/rate-limit/rate-limit.config";
import { SupabaseAuthGuard } from "../../identity/api/guards/supabase-auth.guard";
import { PlatformAdminGuard } from "./guards/platform-admin.guard";
import { PlatformAdminService } from "../application/platform-admin.service";

const RATE_LIMIT = loadRateLimitConfig();

/**
 * Rasid Platform Admin — Phase 12. Every route requires BOTH a verified
 * Supabase session (`SupabaseAuthGuard`) AND the caller's id to be in the
 * `platform_admins` allowlist (`PlatformAdminGuard`) — guard order matters
 * (auth must run first so the guard has a verified user to check). No
 * `@RequirePermission`/workspace-scoped guard is used anywhere in this
 * controller — this is deliberately NOT a tenant/workspace concept.
 * Read-only in V1 — see the module's own closure-report note.
 */
@ApiTags("platform-admin")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PlatformAdminGuard)
@Throttle({ default: { limit: RATE_LIMIT.platformAdmin.limit, ttl: RATE_LIMIT.platformAdmin.ttlMs } })
@Controller("platform-admin")
export class PlatformAdminController {
  constructor(private readonly service: PlatformAdminService) {}

  @Get("dashboard")
  @ApiOperation({ summary: "Platform-wide counts — no invented MRR/revenue (GET /api/v1/platform-admin/dashboard)" })
  getDashboard(): Promise<PlatformAdminDashboardResponse> {
    return this.service.getDashboard();
  }

  @Get("users")
  @ApiOperation({ summary: "Search/list users across every workspace (GET /api/v1/platform-admin/users)" })
  listUsers(
    @Query("search") search?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<ListPlatformAdminUsersResponse> {
    return this.service.listUsers({ search, cursor, limit: limit ? Number(limit) : undefined });
  }

  @Get("users/:id")
  @ApiOperation({ summary: "User detail + every membership across every workspace (GET /api/v1/platform-admin/users/:id)" })
  getUser(@Param("id") id: string): Promise<PlatformAdminUserDetail> {
    return this.service.getUser(id);
  }

  @Get("workspaces")
  @ApiOperation({ summary: "Search/list every Teacher Workspace (GET /api/v1/platform-admin/workspaces)" })
  listWorkspaces(
    @Query("search") search?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<ListPlatformAdminWorkspacesResponse> {
    return this.service.listWorkspaces({ search, cursor, limit: limit ? Number(limit) : undefined });
  }

  @Get("workspaces/:id")
  @ApiOperation({ summary: "Workspace detail: owner, members, subscription, entitlements (GET /api/v1/platform-admin/workspaces/:id)" })
  getWorkspace(@Param("id") id: string): Promise<PlatformAdminWorkspaceDetail> {
    return this.service.getWorkspace(id);
  }

  @Get("subscriptions")
  @ApiOperation({ summary: "List subscriptions across every workspace, optionally filtered by state (GET /api/v1/platform-admin/subscriptions)" })
  listSubscriptions(
    @Query("state") state?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<ListPlatformAdminSubscriptionsResponse> {
    return this.service.listSubscriptions({ state, cursor, limit: limit ? Number(limit) : undefined });
  }
}
