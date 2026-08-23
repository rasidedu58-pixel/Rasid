import { Controller, HttpCode, HttpStatus, Post, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { extractHeader } from "../../common/http/header-utils";
import { BillingService } from "../application/billing.service";

const PADDLE_SIGNATURE_HEADER = "paddle-signature";

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
 */
@ApiTags("webhooks")
@Controller("webhooks")
export class WebhooksController {
  constructor(private readonly billingService: BillingService) {}

  @Post("paddle")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Paddle billing webhook — signature-verified, idempotent source of truth (POST /api/v1/webhooks/paddle)" })
  async handlePaddleWebhook(@Req() request: FastifyRequest & { rawBody?: string }): Promise<{ received: true }> {
    const rawBody = request.rawBody ?? "";
    const signatureHeader = extractHeader(request, PADDLE_SIGNATURE_HEADER) ?? undefined;
    await this.billingService.handlePaddleWebhook(rawBody, signatureHeader);
    return { received: true };
  }
}
