import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../../identity/api/guards/supabase-auth.guard";
import { SupabaseAuthGuard } from "../../identity/api/guards/supabase-auth.guard";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import { CurrentUser } from "../../identity/api/decorators/current-user.decorator";
import { REQUEST_ID_HEADER } from "../../common/middleware/request-id.middleware";
import { extractHeader } from "../../common/http/header-utils";
import { CurrentWorkspaceContext } from "../../team/api/decorators/current-workspace-context.decorator";
import { PermissionGuard, type WorkspaceContext } from "../../team/api/guards/permission.guard";
import {
  createMonthConfirmRequestSchema,
  createMonthPreviewRequestSchema,
  type CreateMonthConfirmResponse,
  type CreateMonthPreviewRequest,
  type CreateMonthPreviewResponse,
  type ListMonthsResponse,
  type OperatingMonth,
} from "@academic-precision/contracts";
import { ValidationApiException } from "../../common/exceptions/api.exception";
import { toFieldErrors } from "../../common/validation/zod-field-errors";
import { SchedulingService } from "../application/scheduling.service";

const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

/**
 * Thin controller — Phase 3 Months endpoints (API Contract §9.2, §11.3,
 * §11.4). `POST /months/preview` and `POST /months` are Owner-only,
 * enforced server-side inside `SchedulingService` (no `@RequirePermission`
 * catalog key expresses "Owner only" directly — see the service's
 * `assertOwner` helper). No `@RequirePermission` decorator therefore
 * appears on those two routes; `PermissionGuard` still requires an ACTIVE
 * membership per its no-explicit-permission branch.
 */
@ApiTags("months")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PermissionGuard)
@Controller()
export class MonthsController {
  constructor(private readonly schedulingService: SchedulingService) {}

  @Get("months")
  @ApiOperation({ summary: "List current/history operating months (GET /api/v1/months)" })
  listMonths(@CurrentWorkspaceContext() workspaceContext: WorkspaceContext): Promise<ListMonthsResponse> {
    return this.schedulingService.listMonths(workspaceContext);
  }

  @Get("months/:id")
  @ApiOperation({ summary: "Operating month details (GET /api/v1/months/:id)" })
  getMonth(
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
  ): Promise<OperatingMonth> {
    return this.schedulingService.getMonth(workspaceContext, id);
  }

  @Post("months/preview")
  @ApiOperation({ summary: "Carry-forward preview + previewToken, Owner-only (POST /api/v1/months/preview)" })
  previewCreateMonth(
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Body() body: unknown,
  ): Promise<CreateMonthPreviewResponse> {
    const parsed = createMonthPreviewRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.schedulingService.previewCreateMonth(workspaceContext, parsed.data as CreateMonthPreviewRequest);
  }

  @Post("months")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Create month transaction; Idempotency-Key required, Owner-only (POST /api/v1/months)" })
  confirmCreateMonth(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<CreateMonthConfirmResponse> {
    const parsed = createMonthConfirmRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    const idempotencyKey = extractHeader(request, IDEMPOTENCY_KEY_HEADER);
    return this.schedulingService.confirmCreateMonth(
      user,
      workspaceContext,
      idempotencyKey,
      parsed.data,
      extractHeader(request, REQUEST_ID_HEADER),
    );
  }
}
