import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import type {
  AcceptInvitationResponse,
  CreateInvitationResponse,
  InvitationPreviewResponse,
  ListInvitationsResponse,
  RevokeInvitationResponse,
} from "@academic-precision/contracts";
import { CurrentUser } from "../../identity/api/decorators/current-user.decorator";
import { SupabaseAuthGuard, type AuthenticatedRequest } from "../../identity/api/guards/supabase-auth.guard";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import { REQUEST_ID_HEADER } from "../../common/middleware/request-id.middleware";
import { InvitationsService } from "../application/invitations.service";
import { CurrentWorkspaceContext } from "./decorators/current-workspace-context.decorator";
import { RequirePermission } from "./decorators/require-permission.decorator";
import { PermissionGuard, type WorkspaceContext } from "./guards/permission.guard";
import { EntitlementGuard } from "../../billing/api/guards/entitlement.guard";
import { RequireEntitlement } from "../../billing/api/decorators/require-entitlement.decorator";

function extractCorrelationId(request: FastifyRequest): string | null {
  const header = request.headers[REQUEST_ID_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  return value ?? null;
}

/**
 * Owner-facing invitation management — workspace-scoped (PermissionGuard,
 * `team.manage`) and entitlement-gated (`TEAM_MANAGEMENT`), exactly like the
 * membership mutation routes.
 */
@ApiTags("team")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PermissionGuard)
@Controller()
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post("invitations")
  @RequirePermission("team.manage")
  @UseGuards(EntitlementGuard)
  @RequireEntitlement("TEAM_MANAGEMENT")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Create a shareable invitation link (owner-only)" })
  createInvitation(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<CreateInvitationResponse> {
    return this.invitationsService.createInvitation(user, workspaceContext, body, extractCorrelationId(request));
  }

  @Get("invitations")
  @RequirePermission("team.manage")
  @ApiOperation({ summary: "List the workspace's invitations (owner-only)" })
  listInvitations(@CurrentWorkspaceContext() workspaceContext: WorkspaceContext): Promise<ListInvitationsResponse> {
    return this.invitationsService.listInvitations(workspaceContext);
  }

  @Post("invitations/:id/revoke")
  @RequirePermission("team.manage")
  @UseGuards(EntitlementGuard)
  @RequireEntitlement("TEAM_MANAGEMENT")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Revoke a pending invitation (owner-only)" })
  revokeInvitation(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") invitationId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<RevokeInvitationResponse> {
    return this.invitationsService.revokeInvitation(user, workspaceContext, invitationId, extractCorrelationId(request));
  }
}

/**
 * Invitee-facing accept flow — authenticated ONLY (SupabaseAuthGuard), NO
 * workspace context and NO PermissionGuard: the invitee is not yet a member
 * of the target workspace, so a permission/workspace check would wrongly 403.
 * Authority here is the high-entropy token itself; the service validates it
 * and fails closed (opaque 404) on any invalid/expired/used token.
 */
@ApiTags("team")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller()
export class InvitationAcceptController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Get("invitations/token/:token")
  @ApiOperation({ summary: "Preview an invitation by its raw token (authenticated)" })
  previewInvitation(
    @CurrentUser() user: VerifiedSupabaseToken,
    @Param("token") token: string,
  ): Promise<InvitationPreviewResponse> {
    return this.invitationsService.previewInvitation(user, token);
  }

  @Post("invitations/token/:token/accept")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Accept an invitation by its raw token (authenticated)" })
  acceptInvitation(
    @CurrentUser() user: VerifiedSupabaseToken,
    @Param("token") token: string,
  ): Promise<AcceptInvitationResponse> {
    return this.invitationsService.acceptInvitation(user, token);
  }
}
