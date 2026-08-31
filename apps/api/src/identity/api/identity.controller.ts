import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type {
  MeResponse,
  OnboardingCompleteResponse,
  TeacherProfile,
  WorkspaceContextResponse,
} from "@academic-precision/contracts";
import { IdentityService } from "../application/identity.service";
import { CurrentUser } from "./decorators/current-user.decorator";
import { SupabaseAuthGuard } from "./guards/supabase-auth.guard";
import type { VerifiedSupabaseToken } from "../infrastructure/jwt-token-verifier";

/**
 * Thin controller — every route requires a verified Supabase session
 * (SupabaseAuthGuard). All business/authorization logic lives in
 * IdentityService (API Contract §9.1, §11.1, §11.2).
 */
@ApiTags("identity")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller()
export class IdentityController {
  constructor(private readonly identityService: IdentityService) {}

  @Get("me")
  @ApiOperation({ summary: "Authenticated user + their workspaces (GET /api/v1/me)" })
  getMe(@CurrentUser() user: VerifiedSupabaseToken): Promise<MeResponse> {
    return this.identityService.getMe(user);
  }

  @Get("me/workspaces/:id/context")
  @ApiOperation({
    summary:
      "Effective membership/permissions/entitlements/subscription for one workspace. " +
      "Requires active membership; unknown/foreign workspace ids return the same safe 404.",
  })
  getWorkspaceContext(
    @CurrentUser() user: VerifiedSupabaseToken,
    @Param("id") workspaceId: string,
  ): Promise<WorkspaceContextResponse> {
    return this.identityService.getWorkspaceContext(user, workspaceId);
  }

  @Patch("me/profile")
  @ApiOperation({ summary: "Update the caller's teacher profile (name / phone / governorate / subject)" })
  updateProfile(@CurrentUser() user: VerifiedSupabaseToken, @Body() body: unknown): Promise<TeacherProfile> {
    return this.identityService.updateProfile(user, body);
  }

  @Post("onboarding/complete")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Complete owner onboarding for the caller's workspace" })
  completeOnboarding(
    @CurrentUser() user: VerifiedSupabaseToken,
    @Body() body: unknown,
  ): Promise<OnboardingCompleteResponse> {
    return this.identityService.completeOnboarding(user, body);
  }
}
