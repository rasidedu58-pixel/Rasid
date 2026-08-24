import { Controller, HttpCode, HttpStatus, Post, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { extractHeader } from "../../common/http/header-utils";
import { loadRateLimitConfig } from "../../common/rate-limit/rate-limit.config";
import { BillingService } from "../application/billing.service";

const PADDLE_SIGNATURE_HEADER = "paddle-signature";
const RATE_LIMIT = loadRateLimitConfig();

/**
 * `POST /webhooks/paddle` — API Contract §11.16. DELIBERATELY no
 * `@UseGuards(SupabaseAuthGuard, ...)`: Paddle calls this with no Bearer
 * token and no `X-Workspace-Id` header at all — the ONLY authority here is
 * the HMAC signature (verified inside `BillingService.handlePaddleWebhook`
 * against the raw body). This is exactly ADR-014's "webhook/backend
 * confirmation هو Source of Truth" — a route that is public-reachable but
 * whose every effect is gated by a cryptographic check, not by Nest's own
 * membership/permission guards (which have no concept of "the caller is
 * Paddle").
 *
 * Phase 10 correction: the `webhook` rate-limit tier below is
 * defense-in-depth ONLY, generous enough to never throttle a legitimate
 * Paddle retry burst — signature verification + idempotency
 * (`BillingService.handlePaddleWebhook`) remain the ONLY authoritative
 * defense against a forged/replayed webhook. Rate limiting alone must
 * never be relied on here.
 */
@ApiTags("webhooks")
@Controller("webhooks")
export class WebhooksController {
  constructor(private readonly billingService: BillingService) {}

  @Post("paddle")
  @Throttle({ default: { limit: RATE_LIMIT.webhook.limit, ttl: RATE_LIMIT.webhook.ttlMs } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Paddle billing webhook — signature-verified, idempotent source of truth (POST /api/v1/webhooks/paddle)" })
  async handlePaddleWebhook(@Req() request: FastifyRequest & { rawBody?: string }): Promise<{ received: true }> {
    const rawBody = request.rawBody ?? "";
    const signatureHeader = extractHeader(request, PADDLE_SIGNATURE_HEADER) ?? undefined;
    await this.billingService.handlePaddleWebhook(rawBody, signatureHeader);
    return { received: true };
  }
}
