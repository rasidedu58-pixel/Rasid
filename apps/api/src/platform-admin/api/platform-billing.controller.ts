import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { rejectPaymentRequestSchema, type LaunchReadinessResponse, type ListBillingAttentionResponse, type ListPlatformBillingHistoryResponse, type ListPlatformPaymentRequestsResponse, type ResolvePaymentRequestResponse } from "@academic-precision/contracts";
import { loadRateLimitConfig } from "../../common/rate-limit/rate-limit.config";
import { CurrentUser } from "../../identity/api/decorators/current-user.decorator";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import { SupabaseAuthGuard } from "../../identity/api/guards/supabase-auth.guard";
import { ValidationApiException } from "../../common/exceptions/api.exception";
import { toFieldErrors } from "../../common/validation/zod-field-errors";
import { PlatformAdminGuard } from "./guards/platform-admin.guard";
import { PlatformPermissionGuard, RequirePlatformPermission } from "./guards/platform-permission.guard";
import { PlatformBillingService } from "../application/platform-billing.service";

const RATE_LIMIT = loadRateLimitConfig();

/**
 * Platform-admin Billing Center (Phase 3). Reads gated by platform.billing.view,
 * confirm/reject by platform.billing.manage — SUPPORT_AGENT has neither, so it
 * can never confirm a payment (enforced by the guard, not just the UI).
 */
@ApiTags("platform-admin")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PlatformAdminGuard, PlatformPermissionGuard)
@Throttle({ default: { limit: RATE_LIMIT.platformAdmin.limit, ttl: RATE_LIMIT.platformAdmin.ttlMs } })
@Controller("platform-admin")
export class PlatformBillingController {
  constructor(private readonly service: PlatformBillingService) {}

  @Get("payment-requests")
  @RequirePlatformPermission("platform.billing.view")
  @ApiOperation({ summary: "List payment requests across customers (Billing Center)" })
  list(
    @Query("status") status?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<ListPlatformPaymentRequestsResponse> {
    return this.service.listPaymentRequests({ status, cursor, limit: limit ? Number(limit) : undefined });
  }

  @Get("billing/attention")
  @RequirePlatformPermission("platform.billing.view")
  @ApiOperation({ summary: "Deterministic billing attention queue (severity + age) — Billing Center" })
  attention(): Promise<ListBillingAttentionResponse> {
    return this.service.getAttention();
  }

  @Get("billing/readiness")
  @RequirePlatformPermission("platform.billing.view")
  @ApiOperation({ summary: "Launch readiness (booleans only, never secrets) — distinct from app health" })
  readiness(): Promise<LaunchReadinessResponse> {
    return this.service.getReadiness();
  }

  @Get("billing/history")
  @RequirePlatformPermission("platform.billing.view")
  @ApiOperation({ summary: "Curated cross-customer billing history (read-only, paginated) — no raw audit JSON / notes / recommendation" })
  history(
    @Query("workspaceId") workspaceId?: string,
    @Query("category") category?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<ListPlatformBillingHistoryResponse> {
    const parsedLimit = limit ? Number(limit) : undefined;
    return this.service.getHistory({ workspaceId, category, cursor, limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined });
  }

  @Post("payment-requests/:id/confirm")
  @RequirePlatformPermission("platform.billing.manage")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Confirm a payment request — creates an immutable payment and activates the subscription" })
  confirm(@Param("id") id: string, @CurrentUser() user: VerifiedSupabaseToken): Promise<ResolvePaymentRequestResponse> {
    return this.service.confirm(id, user.id);
  }

  @Post("payment-requests/:id/reject")
  @RequirePlatformPermission("platform.billing.manage")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Reject a payment request (reason mandatory) — no payment, no subscription change" })
  reject(@Param("id") id: string, @CurrentUser() user: VerifiedSupabaseToken, @Body() body: unknown): Promise<ResolvePaymentRequestResponse> {
    const parsed = rejectPaymentRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.service.reject(id, user.id, parsed.data.reason);
  }
}
