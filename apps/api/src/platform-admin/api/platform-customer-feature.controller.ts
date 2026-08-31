import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type {
  CreateCustomerInvitationResponse,
  ListCustomerInvitationsResponse,
  ListWorkspaceFeaturesResponse,
} from "@academic-precision/contracts";
import { loadRateLimitConfig } from "../../common/rate-limit/rate-limit.config";
import { CurrentUser } from "../../identity/api/decorators/current-user.decorator";
import { SupabaseAuthGuard } from "../../identity/api/guards/supabase-auth.guard";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import { PlatformAdminGuard } from "./guards/platform-admin.guard";
import { PlatformPermissionGuard, RequirePlatformPermission } from "./guards/platform-permission.guard";
import { PlatformCustomerFeatureService } from "../application/platform-customer-feature.service";

const RATE_LIMIT = loadRateLimitConfig();

/**
 * Customer Creation via Secure Invite (`platform.customers.manage`) + Workspace
 * Feature Overrides (`platform.features.manage` to mutate; `platform.customers.view`
 * to read the Customer 360 features panel). Same outer gate as the ops console.
 * The customer's own preview/claim live in the separate onboarding controller.
 */
@ApiTags("platform-admin")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PlatformAdminGuard, PlatformPermissionGuard)
@Throttle({ default: { limit: RATE_LIMIT.platformAdmin.limit, ttl: RATE_LIMIT.platformAdmin.ttlMs } })
@Controller("platform-admin")
export class PlatformCustomerFeatureController {
  constructor(private readonly service: PlatformCustomerFeatureService) {}

  // --- Customer invitations -------------------------------------------------
  @Get("customer-invitations")
  @RequirePlatformPermission("platform.customers.manage")
  @ApiOperation({ summary: "List customer onboarding invitations" })
  listCustomerInvitations(@Query("cursor") cursor?: string, @Query("limit") limit?: string): Promise<ListCustomerInvitationsResponse> {
    return this.service.listCustomerInvitations(cursor, limit ? Number(limit) : undefined);
  }

  @Post("customer-invitations")
  @RequirePlatformPermission("platform.customers.manage")
  @ApiOperation({ summary: "Create a customer via secure onboarding invite (no password set)" })
  createCustomerInvitation(@CurrentUser() user: VerifiedSupabaseToken, @Body() body: unknown): Promise<CreateCustomerInvitationResponse> {
    return this.service.createCustomerInvitation(user, body);
  }

  @Post("customer-invitations/:id/revoke")
  @RequirePlatformPermission("platform.customers.manage")
  @ApiOperation({ summary: "Revoke a pending customer invitation" })
  revokeCustomerInvitation(@Param("id") id: string, @CurrentUser() user: VerifiedSupabaseToken): Promise<{ id: string; status: "REVOKED" }> {
    return this.service.revokeCustomerInvitation(user, id);
  }

  // --- Workspace feature overrides ------------------------------------------
  @Get("workspaces/:id/features")
  @RequirePlatformPermission("platform.customers.view")
  @ApiOperation({ summary: "Resolved feature availability for a workspace (global + override)" })
  listWorkspaceFeatures(@Param("id") id: string): Promise<ListWorkspaceFeaturesResponse> {
    return this.service.listWorkspaceFeatures(id);
  }

  @Post("workspaces/:id/feature-override")
  @RequirePlatformPermission("platform.features.manage")
  @ApiOperation({ summary: "Set a per-workspace feature override (ENABLE / DISABLE)" })
  setFeatureOverride(@Param("id") id: string, @CurrentUser() user: VerifiedSupabaseToken, @Body() body: unknown): Promise<{ featureKey: string; state: string }> {
    return this.service.setFeatureOverride(id, user, body);
  }

  @Post("workspaces/:id/feature-override/revoke")
  @RequirePlatformPermission("platform.features.manage")
  @ApiOperation({ summary: "Revoke a per-workspace feature override (back to global default)" })
  revokeFeatureOverride(@Param("id") id: string, @CurrentUser() user: VerifiedSupabaseToken, @Body() body: unknown): Promise<{ featureKey: string }> {
    return this.service.revokeFeatureOverride(id, user, body);
  }
}

/**
 * Customer-facing onboarding endpoints — token IS the authority, so only
 * `SupabaseAuthGuard`. The customer signs up through normal Supabase Auth; on
 * first arrival here their invite is claimed and linked to the workspace the
 * existing lazy provisioning already created for them. Nothing is provisioned
 * by the claim itself.
 */
@ApiTags("platform-admin")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller("platform-admin/customer-invitations/token")
export class PlatformOnboardingController {
  constructor(private readonly service: PlatformCustomerFeatureService) {}

  @Get(":token")
  @ApiOperation({ summary: "Preview a customer onboarding invitation by token" })
  preview(@Param("token") token: string) {
    return this.service.previewCustomerInvitation(token);
  }

  @Post(":token/claim")
  @ApiOperation({ summary: "Claim a customer onboarding invitation after signing in" })
  claim(@Param("token") token: string, @CurrentUser() user: VerifiedSupabaseToken) {
    return this.service.claimCustomerInvitation(user, token);
  }
}
