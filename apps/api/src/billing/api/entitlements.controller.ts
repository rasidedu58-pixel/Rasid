import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { SupabaseAuthGuard } from "../../identity/api/guards/supabase-auth.guard";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import { CurrentUser } from "../../identity/api/decorators/current-user.decorator";
import { CurrentWorkspaceContext } from "../../team/api/decorators/current-workspace-context.decorator";
import { PermissionGuard, type WorkspaceContext } from "../../team/api/guards/permission.guard";
import type { ListEntitlementsResponse } from "@academic-precision/contracts";
import { BillingService } from "../application/billing.service";

/**
 * Thin controller — `GET /entitlements` (API Contract §9.9: "Active
 * membership | — | Effective workspace capabilities"). No
 * `@RequirePermission`/`@RequireEntitlement` — `PermissionGuard`'s own
 * no-decorator fallback already requires an ACTIVE membership, and this
 * endpoint's entire purpose is telling the caller what the workspace CAN
 * do, so gating it BY an entitlement would be circular.
 */
@ApiTags("entitlements")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PermissionGuard)
@Controller("entitlements")
export class EntitlementsController {
  constructor(private readonly billingService: BillingService) {}

  @Get()
  @ApiOperation({ summary: "Effective workspace capabilities (GET /api/v1/entitlements)" })
  listEntitlements(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
  ): Promise<ListEntitlementsResponse> {
    return this.billingService.listEntitlements(user, workspaceContext);
  }
}
