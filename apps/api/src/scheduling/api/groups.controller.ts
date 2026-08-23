import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../../identity/api/guards/supabase-auth.guard";
import { SupabaseAuthGuard } from "../../identity/api/guards/supabase-auth.guard";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import { CurrentUser } from "../../identity/api/decorators/current-user.decorator";
import { REQUEST_ID_HEADER } from "../../common/middleware/request-id.middleware";
import { extractHeader } from "../../common/http/header-utils";
import { CurrentWorkspaceContext } from "../../team/api/decorators/current-workspace-context.decorator";
import { RequirePermission } from "../../team/api/decorators/require-permission.decorator";
import { PermissionGuard, type WorkspaceContext } from "../../team/api/guards/permission.guard";
import { EntitlementGuard } from "../../billing/api/guards/entitlement.guard";
import { RequireEntitlement } from "../../billing/api/decorators/require-entitlement.decorator";
import {
  createGroupRequestSchema,
  updateGroupRequestSchema,
  type CreateGroupRequest,
  type Group,
  type ListGroupsResponse,
  type UpdateGroupRequest,
} from "@academic-precision/contracts";
import { ValidationApiException } from "../../common/exceptions/api.exception";
import { toFieldErrors } from "../../common/validation/zod-field-errors";
import { SchedulingService } from "../application/scheduling.service";

/**
 * Thin controller — Phase 3 Groups endpoints (API Contract §9.3). All
 * business/authorization logic lives in `SchedulingService`.
 */
@ApiTags("groups")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PermissionGuard)
@Controller("groups")
export class GroupsController {
  constructor(private readonly schedulingService: SchedulingService) {}

  @Get()
  @RequirePermission("groups.view")
  @ApiOperation({ summary: "List groups in the caller's scope (GET /api/v1/groups)" })
  listGroups(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
  ): Promise<ListGroupsResponse> {
    return this.schedulingService.listGroups(user, workspaceContext);
  }

  @Post()
  @RequirePermission("groups.manage")
  @UseGuards(EntitlementGuard)
  @RequireEntitlement("CORE_OPERATIONS")
  @ApiOperation({ summary: "Create a stable Group identity (POST /api/v1/groups)" })
  createGroup(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<Group> {
    const parsed = createGroupRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.schedulingService.createGroup(
      user,
      workspaceContext,
      parsed.data as CreateGroupRequest,
      extractHeader(request, REQUEST_ID_HEADER),
    );
  }

  @Get(":id")
  @RequirePermission("groups.view")
  @ApiOperation({ summary: "Group details, safe no-leak 404 out of scope (GET /api/v1/groups/:id)" })
  getGroup(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
  ): Promise<Group> {
    return this.schedulingService.getGroup(user, workspaceContext, id);
  }

  @Patch(":id")
  @RequirePermission("groups.manage")
  @UseGuards(EntitlementGuard)
  @RequireEntitlement("CORE_OPERATIONS")
  @ApiOperation({ summary: "Versioned edit of a Group's stable identity (PATCH /api/v1/groups/:id)" })
  updateGroup(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<Group> {
    const parsed = updateGroupRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.schedulingService.updateGroup(
      user,
      workspaceContext,
      id,
      parsed.data as UpdateGroupRequest,
      extractHeader(request, REQUEST_ID_HEADER),
    );
  }
}
