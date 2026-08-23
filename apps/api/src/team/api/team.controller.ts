import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import type {
  DisableMembershipResponse,
  ListTeamResponse,
  UpdateMembershipPermissionsResponse,
} from "@academic-precision/contracts";
import { CurrentUser } from "../../identity/api/decorators/current-user.decorator";
import { SupabaseAuthGuard, type AuthenticatedRequest } from "../../identity/api/guards/supabase-auth.guard";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import { REQUEST_ID_HEADER } from "../../common/middleware/request-id.middleware";
import { TeamService } from "../application/team.service";
import { CurrentWorkspaceContext } from "./decorators/current-workspace-context.decorator";
import { RequirePermission } from "./decorators/require-permission.decorator";
import { PermissionGuard, type WorkspaceContext } from "./guards/permission.guard";
import { EntitlementGuard } from "../../billing/api/guards/entitlement.guard";
import { RequireEntitlement } from "../../billing/api/decorators/require-entitlement.decorator";

/**
 * Thin controller — every route requires a verified Supabase session
 * (SupabaseAuthGuard) and workspace-scoped authorization (PermissionGuard,
 * resolved from the `X-Workspace-Id` header). All business/authorization
 * logic lives in TeamService (API Contract §9.8, Phase 2 scope).
 */
@ApiTags("team")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PermissionGuard)
@Controller()
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Get("team")
  @ApiOperation({ summary: "List memberships of the caller's workspace (GET /api/v1/team)" })
  listTeam(@CurrentWorkspaceContext() workspaceContext: WorkspaceContext): Promise<ListTeamResponse> {
    return this.teamService.listTeam(workspaceContext);
  }

  @Patch("memberships/:id/permissions")
  @RequirePermission("team.manage")
  @UseGuards(EntitlementGuard)
  @RequireEntitlement("TEAM_MANAGEMENT")
  @ApiOperation({ summary: "Replace a membership's active permission grants (owner-only)" })
  updateMembershipPermissions(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") membershipId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<UpdateMembershipPermissionsResponse> {
    const correlationId = this.extractCorrelationId(request);
    return this.teamService.updateMembershipPermissions(user, workspaceContext, membershipId, body, correlationId);
  }

  @Post("memberships/:id/disable")
  @RequirePermission("team.manage")
  @UseGuards(EntitlementGuard)
  @RequireEntitlement("TEAM_MANAGEMENT")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Disable a membership without deleting its history (owner-only)" })
  disableMembership(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") membershipId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<DisableMembershipResponse> {
    const correlationId = this.extractCorrelationId(request);
    return this.teamService.disableMembership(user, workspaceContext, membershipId, correlationId);
  }

  private extractCorrelationId(request: FastifyRequest): string | null {
    const header = request.headers[REQUEST_ID_HEADER];
    const value = Array.isArray(header) ? header[0] : header;
    return value ?? null;
  }
}
