import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { OnboardingStatusResponse } from "@academic-precision/contracts";
import { SupabaseAuthGuard } from "../../identity/api/guards/supabase-auth.guard";
import { CurrentWorkspaceContext } from "../../team/api/decorators/current-workspace-context.decorator";
import {
  PermissionGuard,
  type WorkspaceContext,
} from "../../team/api/guards/permission.guard";
import { OnboardingService } from "../application/onboarding.service";

/**
 * `GET /onboarding/status` — read-only guided-setup progress for the
 * caller's active workspace. Available to every ACTIVE member; the web
 * layer decides who sees the launcher (Owner-only) versus a passive
 * "workspace is still being set up" notice.
 *
 * Rationale for guard set (matching `ActionCenterController`):
 *   • `SupabaseAuthGuard` verifies the bearer token.
 *   • `PermissionGuard` resolves `X-Workspace-Id` to an ACTIVE
 *     membership and attaches the `WorkspaceContext`.
 * No `@RequirePermission(...)` — this endpoint returns booleans about
 * plumbing state, not workspace domain content, so gating it on a
 * granular permission would defeat its own purpose (non-owners still
 * need it to render the passive notice correctly).
 */
@ApiTags("onboarding")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PermissionGuard)
@Controller("onboarding")
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Get("status")
  @ApiOperation({
    summary: "Guided-setup progress (GET /api/v1/onboarding/status)",
  })
  getStatus(
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
  ): Promise<OnboardingStatusResponse> {
    return this.onboardingService.getStatus(workspaceContext.workspaceId);
  }
}
