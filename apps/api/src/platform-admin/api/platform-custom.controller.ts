import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createCustomOfferSchema, type ListPlatformCustomRequestsResponse } from "@academic-precision/contracts";
import { loadRateLimitConfig } from "../../common/rate-limit/rate-limit.config";
import { CurrentUser } from "../../identity/api/decorators/current-user.decorator";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import { SupabaseAuthGuard } from "../../identity/api/guards/supabase-auth.guard";
import { ValidationApiException } from "../../common/exceptions/api.exception";
import { toFieldErrors } from "../../common/validation/zod-field-errors";
import { PlatformAdminGuard } from "./guards/platform-admin.guard";
import { PlatformPermissionGuard, RequirePlatformPermission } from "./guards/platform-permission.guard";
import { PlatformCustomService } from "../application/platform-custom.service";

const RATE_LIMIT = loadRateLimitConfig();

/** Platform-admin Custom Plans (Phase 5). Read gated by platform.billing.view, author-offer by platform.billing.manage (SUPPORT_AGENT has neither). */
@ApiTags("platform-admin")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PlatformAdminGuard, PlatformPermissionGuard)
@Throttle({ default: { limit: RATE_LIMIT.platformAdmin.limit, ttl: RATE_LIMIT.platformAdmin.ttlMs } })
@Controller("platform-admin/custom")
export class PlatformCustomController {
  constructor(private readonly service: PlatformCustomService) {}

  @Get("requests")
  @RequirePlatformPermission("platform.billing.view")
  @ApiOperation({ summary: "List custom-plan requests (with internal recommendation)" })
  listRequests(@Query("status") status?: string): Promise<ListPlatformCustomRequestsResponse> {
    return this.service.listRequests(status);
  }

  @Get("requests/:id/offers")
  @RequirePlatformPermission("platform.billing.view")
  @ApiOperation({ summary: "Offer history for a request (versions)" })
  listOffers(@Param("id") id: string) {
    return this.service.listOffers(id);
  }

  @Post("offers")
  @RequirePlatformPermission("platform.billing.manage")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Author a custom offer (or a revised version) — reason mandatory when the price differs from the recommendation" })
  createOffer(@CurrentUser() user: VerifiedSupabaseToken, @Body() body: unknown) {
    const parsed = createCustomOfferSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.service.createOffer(user.id, parsed.data);
  }
}
