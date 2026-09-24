import { Body, Controller, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { ListPlatformLeadsResponse, PlatformLead, PlatformLeadMetrics } from "@academic-precision/contracts";
import { loadRateLimitConfig } from "../../common/rate-limit/rate-limit.config";
import { CurrentUser } from "../../identity/api/decorators/current-user.decorator";
import { SupabaseAuthGuard } from "../../identity/api/guards/supabase-auth.guard";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import { PlatformAdminGuard } from "./guards/platform-admin.guard";
import { PlatformPermissionGuard, RequirePlatformPermission } from "./guards/platform-permission.guard";
import { PlatformLeadsService } from "../application/platform-leads.service";

const RATE_LIMIT = loadRateLimitConfig();

/**
 * Platform Leads — Phase 16 Part B. Platform-Admin-ONLY: the same outer gate
 * as the rest of the ops console (`SupabaseAuthGuard` + `PlatformAdminGuard`)
 * plus `PlatformPermissionGuard`, so a workspace Owner (no platform role)
 * gets a plain 403 and never reaches this data. Reads require
 * `platform.leads.view`; the follow-up edit requires `platform.leads.manage`.
 */
@ApiTags("platform-admin")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PlatformAdminGuard, PlatformPermissionGuard)
@Throttle({ default: { limit: RATE_LIMIT.platformAdmin.limit, ttl: RATE_LIMIT.platformAdmin.ttlMs } })
@Controller("platform-admin")
export class PlatformLeadsController {
  constructor(private readonly service: PlatformLeadsService) {}

  @Get("leads")
  @RequirePlatformPermission("platform.leads.view")
  @ApiOperation({ summary: "List platform leads (new signups) in follow-up priority order" })
  listLeads(
    @Query("filter") filter?: string,
    @Query("search") search?: string,
    @Query("limit") limit?: string,
  ): Promise<ListPlatformLeadsResponse> {
    return this.service.listLeads({ filter, search, limit: limit ? Number(limit) : undefined });
  }

  @Get("leads/metrics")
  @RequirePlatformPermission("platform.leads.view")
  @ApiOperation({ summary: "Lead metrics (new / needs follow-up / due today / converted)" })
  metrics(): Promise<PlatformLeadMetrics> {
    return this.service.getMetrics();
  }

  @Patch("leads/:id")
  @RequirePlatformPermission("platform.leads.manage")
  @ApiOperation({ summary: "Update a lead's status / follow-up date / note (audited)" })
  updateLead(@Param("id") id: string, @CurrentUser() user: VerifiedSupabaseToken, @Body() body: unknown): Promise<PlatformLead> {
    return this.service.updateLead(id, user.id, body);
  }
}
