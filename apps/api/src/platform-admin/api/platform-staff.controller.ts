import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type {
  CreatePlatformStaffInvitationResponse,
  ListPlatformStaffInvitationsResponse,
  ListPlatformStaffMembersResponse,
} from "@academic-precision/contracts";
import { loadRateLimitConfig } from "../../common/rate-limit/rate-limit.config";
import { CurrentUser } from "../../identity/api/decorators/current-user.decorator";
import { SupabaseAuthGuard } from "../../identity/api/guards/supabase-auth.guard";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import { PlatformAdminGuard } from "./guards/platform-admin.guard";
import { PlatformPermissionGuard, RequirePlatformPermission } from "./guards/platform-permission.guard";
import { PlatformStaffService } from "../application/platform-staff.service";

const RATE_LIMIT = loadRateLimitConfig();

/**
 * Platform Staff Management ("فريق راصد") — every route is OWNER-only
 * (`platform.staff.manage`). Same outer gate as the ops console; the invitee's
 * preview/accept live in a SEPARATE controller (no PlatformAdminGuard — the
 * accepter is not yet a platform admin).
 */
@ApiTags("platform-admin")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PlatformAdminGuard, PlatformPermissionGuard)
@Throttle({ default: { limit: RATE_LIMIT.platformAdmin.limit, ttl: RATE_LIMIT.platformAdmin.ttlMs } })
@Controller("platform-admin")
export class PlatformStaffController {
  constructor(private readonly service: PlatformStaffService) {}

  @Get("staff-members")
  @RequirePlatformPermission("platform.staff.manage")
  @ApiOperation({ summary: "List platform staff (role, status, invited-by)" })
  listStaff(@CurrentUser() user: VerifiedSupabaseToken): Promise<ListPlatformStaffMembersResponse> {
    return this.service.listStaff(user);
  }

  @Get("staff-invitations")
  @RequirePlatformPermission("platform.staff.manage")
  @ApiOperation({ summary: "List platform staff invitations" })
  listInvitations(): Promise<ListPlatformStaffInvitationsResponse> {
    return this.service.listInvitations();
  }

  @Post("staff-invitations")
  @RequirePlatformPermission("platform.staff.manage")
  @ApiOperation({ summary: "Invite a new platform staff member (secure link; no password set)" })
  createInvitation(@CurrentUser() user: VerifiedSupabaseToken, @Body() body: unknown): Promise<CreatePlatformStaffInvitationResponse> {
    return this.service.createInvitation(user, body);
  }

  @Post("staff-invitations/:id/revoke")
  @RequirePlatformPermission("platform.staff.manage")
  @ApiOperation({ summary: "Revoke a pending staff invitation" })
  revokeInvitation(@Param("id") id: string, @CurrentUser() user: VerifiedSupabaseToken): Promise<{ id: string; status: "REVOKED" }> {
    return this.service.revokeInvitation(user, id);
  }

  @Patch("staff-members/:userId/role")
  @RequirePlatformPermission("platform.staff.manage")
  @ApiOperation({ summary: "Change a staff member's role" })
  changeRole(@Param("userId") userId: string, @CurrentUser() user: VerifiedSupabaseToken, @Body() body: unknown) {
    return this.service.changeRole(user, userId, body);
  }

  @Post("staff-members/:userId/account-action")
  @RequirePlatformPermission("platform.staff.manage")
  @ApiOperation({ summary: "Disable / reactivate a staff member's access" })
  accountAction(@Param("userId") userId: string, @CurrentUser() user: VerifiedSupabaseToken, @Body() body: unknown) {
    return this.service.accountAction(user, userId, body);
  }
}

/**
 * Invitee-facing staff-invitation endpoints — token IS the authority, so only
 * `SupabaseAuthGuard` (no PlatformAdminGuard/PermissionGuard: the accepter is a
 * signed-in user who is not yet a platform admin). Acceptance INSERTs their
 * `platform_admins` row; no privilege exists before it.
 */
@ApiTags("platform-admin")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller("platform-admin/staff-invitations/token")
export class PlatformStaffInviteController {
  constructor(private readonly service: PlatformStaffService) {}

  @Get(":token")
  @ApiOperation({ summary: "Preview a staff invitation by token" })
  preview(@Param("token") token: string) {
    return this.service.previewInvitation(token);
  }

  @Post(":token/accept")
  @ApiOperation({ summary: "Accept a staff invitation (joins فريق راصد)" })
  accept(@Param("token") token: string, @CurrentUser() user: VerifiedSupabaseToken) {
    return this.service.acceptInvitation(user, token);
  }
}
