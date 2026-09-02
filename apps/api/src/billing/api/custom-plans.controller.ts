import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createCustomPaymentRequestSchema, createCustomRequestSchema, type CreatePaymentRequestResponse, type GetCustomPlanStateResponse } from "@academic-precision/contracts";
import { SupabaseAuthGuard } from "../../identity/api/guards/supabase-auth.guard";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import { CurrentUser } from "../../identity/api/decorators/current-user.decorator";
import { CurrentWorkspaceContext } from "../../team/api/decorators/current-workspace-context.decorator";
import { PermissionGuard, type WorkspaceContext } from "../../team/api/guards/permission.guard";
import { ValidationApiException } from "../../common/exceptions/api.exception";
import { toFieldErrors } from "../../common/validation/zod-field-errors";
import { loadRateLimitConfig } from "../../common/rate-limit/rate-limit.config";
import { CustomPlansService } from "../application/custom-plans.service";

const RATE_LIMIT = loadRateLimitConfig();

/** Customer Custom-Plan endpoints (Phase 5). Owner-only (asserted in the service). */
@ApiTags("billing")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PermissionGuard)
@Controller("billing/custom")
export class CustomPlansController {
  constructor(private readonly service: CustomPlansService) {}

  @Get("state")
  @ApiOperation({ summary: "Custom-plan state: eligibility, own request, current offer (owner-only)" })
  getState(@CurrentUser() user: VerifiedSupabaseToken, @CurrentWorkspaceContext() ctx: WorkspaceContext): Promise<GetCustomPlanStateResponse> {
    return this.service.getState(user, ctx);
  }

  @Post("requests")
  @Throttle({ default: { limit: RATE_LIMIT.billing.limit, ttl: RATE_LIMIT.billing.ttlMs } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Request a custom plan (>3000 students) — capacities + cycle only; server computes the internal recommendation" })
  createRequest(@CurrentUser() user: VerifiedSupabaseToken, @CurrentWorkspaceContext() ctx: WorkspaceContext, @Body() body: unknown) {
    const parsed = createCustomRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.service.createRequest(user, ctx, parsed.data);
  }

  @Post("requests/cancel")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Cancel the pending custom-plan request (owner-only)" })
  cancelRequest(@CurrentUser() user: VerifiedSupabaseToken, @CurrentWorkspaceContext() ctx: WorkspaceContext) {
    return this.service.cancelRequest(user, ctx);
  }

  @Post("offers/:id/accept")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Accept a custom offer (owner-only). Does NOT activate — makes it eligible for payment." })
  acceptOffer(@CurrentUser() user: VerifiedSupabaseToken, @CurrentWorkspaceContext() ctx: WorkspaceContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.service.acceptOffer(user, ctx, id);
  }

  @Post("offers/:id/reject")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Reject a custom offer (owner-only)" })
  rejectOffer(@CurrentUser() user: VerifiedSupabaseToken, @CurrentWorkspaceContext() ctx: WorkspaceContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.service.rejectOffer(user, ctx, id);
  }

  @Post("payment-request")
  @Throttle({ default: { limit: RATE_LIMIT.billing.limit, ttl: RATE_LIMIT.billing.ttlMs } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Create the CUSTOM payment request from an accepted offer (server-priced) + pay instructions" })
  createPayment(@CurrentUser() user: VerifiedSupabaseToken, @CurrentWorkspaceContext() ctx: WorkspaceContext, @Body() body: unknown): Promise<CreatePaymentRequestResponse> {
    const parsed = createCustomPaymentRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.service.createPayment(user, ctx, parsed.data);
  }
}
