import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { SupabaseAuthGuard } from "../../identity/api/guards/supabase-auth.guard";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import { CurrentUser } from "../../identity/api/decorators/current-user.decorator";
import { CurrentWorkspaceContext } from "../../team/api/decorators/current-workspace-context.decorator";
import { RequirePermission } from "../../team/api/decorators/require-permission.decorator";
import { PermissionGuard, type WorkspaceContext } from "../../team/api/guards/permission.guard";
import { EntitlementGuard } from "../../billing/api/guards/entitlement.guard";
import { RequireEntitlement } from "../../billing/api/decorators/require-entitlement.decorator";
import {
  createReportExportRequestSchema,
  type CreateReportExportRequest,
  type CreateReportExportResponse,
  type GroupReportResponse,
  type MonthlyTeacherReportResponse,
  type StudentReportResponse,
} from "@academic-precision/contracts";
import { ValidationApiException } from "../../common/exceptions/api.exception";
import { toFieldErrors } from "../../common/validation/zod-field-errors";
import { loadRateLimitConfig } from "../../common/rate-limit/rate-limit.config";
import { ReportsService } from "../application/reports.service";

const RATE_LIMIT = loadRateLimitConfig();

/**
 * Thin controller — Phase 9 Reports endpoints (API Contract §9.10,
 * §11.17). `GET /reports/*` are `reports.view`-only, NO Entitlement gate
 * (Historical/Core read — stays available for Expired/Payment Failed).
 * `POST /reports/export` additionally requires `RequireEntitlement
 * ("REPORT_EXPORT")` — the ONLY gated action in this controller.
 */
@ApiTags("reports")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PermissionGuard)
@Controller("reports")
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get("student/:id")
  @RequirePermission("reports.view")
  @ApiOperation({ summary: "Student report (GET /api/v1/reports/student/:id)" })
  getStudentReport(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
  ): Promise<StudentReportResponse> {
    return this.reportsService.getStudentReport(user, workspaceContext, id);
  }

  @Get("group/:id")
  @RequirePermission("reports.view")
  @ApiOperation({ summary: "Group report (GET /api/v1/reports/group/:id)" })
  getGroupReport(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
  ): Promise<GroupReportResponse> {
    return this.reportsService.getGroupReport(user, workspaceContext, id);
  }

  @Get("monthly/:monthId")
  @RequirePermission("reports.view")
  @ApiOperation({ summary: "Monthly teacher report (GET /api/v1/reports/monthly/:monthId)" })
  getMonthlyTeacherReport(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("monthId") monthId: string,
  ): Promise<MonthlyTeacherReportResponse> {
    return this.reportsService.getMonthlyTeacherReport(user, workspaceContext, monthId);
  }

  @Post("export")
  @RequirePermission("reports.export")
  @UseGuards(EntitlementGuard)
  @RequireEntitlement("REPORT_EXPORT")
  @Throttle({ default: { limit: RATE_LIMIT.export.limit, ttl: RATE_LIMIT.export.ttlMs } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "CSV UTF-8 export only in V1 (POST /api/v1/reports/export)" })
  createExport(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Body() body: unknown,
  ): Promise<CreateReportExportResponse> {
    const parsed = createReportExportRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.reportsService.createExport(user, workspaceContext, parsed.data as CreateReportExportRequest);
  }
}
