import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createPaymentRequestSchema, type CreatePaymentRequestResponse, type ListPaymentRequestsResponse } from "@academic-precision/contracts";
import { SupabaseAuthGuard } from "../../identity/api/guards/supabase-auth.guard";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import { CurrentUser } from "../../identity/api/decorators/current-user.decorator";
import { CurrentWorkspaceContext } from "../../team/api/decorators/current-workspace-context.decorator";
import { PermissionGuard, type WorkspaceContext } from "../../team/api/guards/permission.guard";
import { ValidationApiException } from "../../common/exceptions/api.exception";
import { toFieldErrors } from "../../common/validation/zod-field-errors";
import { loadRateLimitConfig } from "../../common/rate-limit/rate-limit.config";
import { PaymentRequestsService } from "../application/payment-requests.service";

const RATE_LIMIT = loadRateLimitConfig();

/**
 * Customer payment-request endpoints (Billing Phase 3). Owner-only (asserted in
 * the service). No `@RequireEntitlement` — a workspace must be able to start
 * paying even when EXPIRED (same rule as the rest of `/billing/*`).
 */
@ApiTags("billing")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PermissionGuard)
@Controller("billing")
export class PaymentRequestsController {
  constructor(private readonly service: PaymentRequestsService) {}

  @Post("payment-requests")
  @Throttle({ default: { limit: RATE_LIMIT.billing.limit, ttl: RATE_LIMIT.billing.ttlMs } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Create a payment request (server-priced) — returns pay instructions + WhatsApp proof deeplink" })
  createPaymentRequest(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Body() body: unknown,
  ): Promise<CreatePaymentRequestResponse> {
    const parsed = createPaymentRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.service.createPaymentRequest(user, workspaceContext, parsed.data);
  }

  @Get("payment-requests")
  @ApiOperation({ summary: "List this workspace's payment requests (owner-only)" })
  listPaymentRequests(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
  ): Promise<ListPaymentRequestsResponse> {
    return this.service.listPaymentRequests(user, workspaceContext);
  }
}
