import { Body, Controller, Param, Post, Req, UseGuards } from "@nestjs/common";
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
  recordPaymentRequestSchema,
  reversePaymentRequestSchema,
  type RecordPaymentRequest,
  type RecordPaymentResponse,
  type ReversePaymentRequest,
  type ReversePaymentResponse,
} from "@academic-precision/contracts";
import { ValidationApiException } from "../../common/exceptions/api.exception";
import { toFieldErrors } from "../../common/validation/zod-field-errors";
import { FinanceService } from "../application/finance.service";

const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

/**
 * Thin controller — Phase 6 Payments endpoints (API Contract §9.6/§11.11-
 * 11.12). All business/authorization logic lives in `FinanceService`.
 */
@ApiTags("payments")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PermissionGuard)
@Controller("payments")
export class PaymentsController {
  constructor(private readonly financeService: FinanceService) {}

  @Post()
  @RequirePermission("payments.record")
  @UseGuards(EntitlementGuard)
  @RequireEntitlement("CORE_OPERATIONS")
  @ApiOperation({ summary: "Post one payment; Idempotency-Key required (POST /api/v1/payments)" })
  recordPayment(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<RecordPaymentResponse> {
    const parsed = recordPaymentRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.financeService.recordPayment(
      user,
      workspaceContext,
      extractHeader(request, IDEMPOTENCY_KEY_HEADER),
      parsed.data as RecordPaymentRequest,
      extractHeader(request, REQUEST_ID_HEADER),
    );
  }

  @Post(":id/reverse")
  @RequirePermission("payments.record")
  @UseGuards(EntitlementGuard)
  @RequireEntitlement("CORE_OPERATIONS")
  @ApiOperation({ summary: "Reverse with mandatory reason; Idempotency-Key required (POST /api/v1/payments/:id/reverse)" })
  reversePayment(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ReversePaymentResponse> {
    const parsed = reversePaymentRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.financeService.reversePayment(
      user,
      workspaceContext,
      id,
      extractHeader(request, IDEMPOTENCY_KEY_HEADER),
      parsed.data as ReversePaymentRequest,
      extractHeader(request, REQUEST_ID_HEADER),
    );
  }
}
