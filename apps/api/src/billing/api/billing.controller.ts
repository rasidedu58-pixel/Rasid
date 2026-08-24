import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { SupabaseAuthGuard } from "../../identity/api/guards/supabase-auth.guard";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import { CurrentUser } from "../../identity/api/decorators/current-user.decorator";
import { CurrentWorkspaceContext } from "../../team/api/decorators/current-workspace-context.decorator";
import { PermissionGuard, type WorkspaceContext } from "../../team/api/guards/permission.guard";
import {
  createCheckoutRequestSchema,
  createPortalRequestSchema,
  type CreateCheckoutResponse,
  type CreatePortalResponse,
  type GetSubscriptionResponse,
} from "@academic-precision/contracts";
import { ValidationApiException } from "../../common/exceptions/api.exception";
import { toFieldErrors } from "../../common/validation/zod-field-errors";
import { loadRateLimitConfig } from "../../common/rate-limit/rate-limit.config";
import { BillingService } from "../application/billing.service";

const RATE_LIMIT = loadRateLimitConfig();

/**
 * Thin controller — Phase 8 Billing endpoints (API Contract §9.9). Owner
 * only, no `@RequireEntitlement` anywhere here (explicit correction:
 * "Billing/renewal endpoints remain accessible independently of
 * operational entitlements") — a fully EXPIRED workspace must still be
 * able to view its subscription, start checkout, and reach its billing
 * portal.
 */
@ApiTags("billing")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PermissionGuard)
@Controller("billing")
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get("subscription")
  @ApiOperation({ summary: "Current commercial state (GET /api/v1/billing/subscription)" })
  getSubscription(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
  ): Promise<GetSubscriptionResponse> {
    return this.billingService.getSubscription(user, workspaceContext);
  }

  @Post("checkout")
  @Throttle({ default: { limit: RATE_LIMIT.billing.limit, ttl: RATE_LIMIT.billing.ttlMs } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Create a Paddle checkout session — the redirect alone grants no access (POST /api/v1/billing/checkout)" })
  createCheckout(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Body() body: unknown,
  ): Promise<CreateCheckoutResponse> {
    const parsed = createCheckoutRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.billingService.createCheckout(user, workspaceContext, parsed.data);
  }

  @Post("portal")
  @Throttle({ default: { limit: RATE_LIMIT.billing.limit, ttl: RATE_LIMIT.billing.ttlMs } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Create a Paddle customer portal session (POST /api/v1/billing/portal)" })
  createPortal(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Body() body: unknown,
  ): Promise<CreatePortalResponse> {
    const parsed = createPortalRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.billingService.createPortal(user, workspaceContext, parsed.data);
  }
}
