import { Controller, Get, Param, Res, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import { SupabaseAuthGuard } from "../../identity/api/guards/supabase-auth.guard";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import { CurrentUser } from "../../identity/api/decorators/current-user.decorator";
import { CurrentWorkspaceContext } from "../../team/api/decorators/current-workspace-context.decorator";
import { RequirePermission } from "../../team/api/decorators/require-permission.decorator";
import { PermissionGuard, type WorkspaceContext } from "../../team/api/guards/permission.guard";
import { EntitlementGuard } from "../../billing/api/guards/entitlement.guard";
import { RequireEntitlement } from "../../billing/api/decorators/require-entitlement.decorator";
import type { GetExportResponse } from "@academic-precision/contracts";
import { loadRateLimitConfig } from "../../common/rate-limit/rate-limit.config";
import { ReportsService } from "../application/reports.service";

const RATE_LIMIT = loadRateLimitConfig();

/**
 * Thin controller — `GET /exports/{id}` and `GET /exports/{id}/download`
 * (API Contract §9.10, §11.17). Both require `reports.export` +
 * `RequireEntitlement("REPORT_EXPORT")` — RE-CHECKED at each call, not just
 * at `POST /reports/export` creation time (Phase 9 Closure correction #4).
 */
@ApiTags("reports")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PermissionGuard, EntitlementGuard)
@Throttle({ default: { limit: RATE_LIMIT.export.limit, ttl: RATE_LIMIT.export.ttlMs } })
@Controller("exports")
export class ExportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get(":id")
  @RequirePermission("reports.export")
  @RequireEntitlement("REPORT_EXPORT")
  @ApiOperation({ summary: "Async export status/signed URL shape (GET /api/v1/exports/:id)" })
  getExportStatus(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
  ): Promise<GetExportResponse> {
    return this.reportsService.getExportStatus(user, workspaceContext, id);
  }

  @Get(":id/download")
  @RequirePermission("reports.export")
  @RequireEntitlement("REPORT_EXPORT")
  @ApiOperation({ summary: "Streams the CSV UTF-8 bytes, re-computed live (GET /api/v1/exports/:id/download)" })
  async download(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const { filename, csv } = await this.reportsService.downloadExport(user, workspaceContext, id);
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
    return csv;
  }
}
