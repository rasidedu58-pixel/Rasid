import { Body, Controller, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from "@nestjs/common";
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
  enrollmentCreateRequestSchema,
  enrollmentPreviewRequestSchema,
  enrollmentTransferPreviewRequestSchema,
  enrollmentTransferRequestSchema,
  enrollmentWithdrawRequestSchema,
  type EnrollmentCreateRequest,
  type EnrollmentCreateResponse,
  type EnrollmentPreviewRequest,
  type EnrollmentPreviewResponse,
  type EnrollmentTransferPreviewRequest,
  type EnrollmentTransferPreviewResponse,
  type EnrollmentTransferRequest,
  type EnrollmentTransferResponse,
  type EnrollmentWithdrawRequest,
  type EnrollmentWithdrawResponse,
} from "@academic-precision/contracts";
import { ValidationApiException } from "../../common/exceptions/api.exception";
import { toFieldErrors } from "../../common/validation/zod-field-errors";
import { EnrollmentsService } from "../application/enrollments.service";

/**
 * Thin controller — Phase 4 Enrollment endpoints (API Contract §9.5).
 * Split into two route groups (`group-months/:id/enrollments...` and
 * `enrollments/:id/...`) under one controller, matching the registry's own
 * path shapes.
 */
@ApiTags("enrollments")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PermissionGuard)
@Controller()
export class EnrollmentsController {
  constructor(private readonly enrollmentsService: EnrollmentsService) {}

  @Post("group-months/:id/enrollments/preview")
  @RequirePermission("students.edit")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Proration/full/custom preview (POST /api/v1/group-months/:id/enrollments/preview)" })
  previewEnrollment(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<EnrollmentPreviewResponse> {
    const parsed = enrollmentPreviewRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.enrollmentsService.previewEnrollment(
      user,
      workspaceContext,
      id,
      parsed.data as EnrollmentPreviewRequest,
    );
  }

  @Post("group-months/:id/enrollments")
  @RequirePermission("students.edit")
  @UseGuards(EntitlementGuard)
  @RequireEntitlement("CORE_OPERATIONS")
  @ApiOperation({ summary: "Create or reactivate an Enrollment (POST /api/v1/group-months/:id/enrollments)" })
  createEnrollment(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<EnrollmentCreateResponse> {
    const parsed = enrollmentCreateRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.enrollmentsService.createEnrollment(
      user,
      workspaceContext,
      id,
      parsed.data as EnrollmentCreateRequest,
      extractHeader(request, REQUEST_ID_HEADER),
    );
  }

  @Post("enrollments/:id/withdraw")
  @RequirePermission("students.edit")
  @UseGuards(EntitlementGuard)
  @RequireEntitlement("CORE_OPERATIONS")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Withdraw with effective reason/date (POST /api/v1/enrollments/:id/withdraw)" })
  withdraw(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<EnrollmentWithdrawResponse> {
    const parsed = enrollmentWithdrawRequestSchema.safeParse(body ?? {});
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.enrollmentsService.withdrawEnrollment(
      user,
      workspaceContext,
      id,
      parsed.data as EnrollmentWithdrawRequest,
      extractHeader(request, REQUEST_ID_HEADER),
    );
  }

  @Post("enrollments/:id/transfer-preview")
  @RequirePermission("students.edit")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Transfer impact preview (POST /api/v1/enrollments/:id/transfer-preview)" })
  transferPreview(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<EnrollmentTransferPreviewResponse> {
    const parsed = enrollmentTransferPreviewRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.enrollmentsService.transferPreview(
      user,
      workspaceContext,
      id,
      parsed.data as EnrollmentTransferPreviewRequest,
    );
  }

  @Post("enrollments/:id/transfer")
  @RequirePermission("students.edit")
  @UseGuards(EntitlementGuard)
  @RequireEntitlement("CORE_OPERATIONS")
  @ApiOperation({ summary: "Transfer preserving Student identity (POST /api/v1/enrollments/:id/transfer)" })
  transfer(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<EnrollmentTransferResponse> {
    const parsed = enrollmentTransferRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.enrollmentsService.transfer(
      user,
      workspaceContext,
      id,
      parsed.data as EnrollmentTransferRequest,
      extractHeader(request, REQUEST_ID_HEADER),
    );
  }
}
