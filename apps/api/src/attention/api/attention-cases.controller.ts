import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
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
  attentionCaseTransitionRequestSchema,
  contactDraftRequestSchema,
  type AttentionCase,
  type AttentionCaseTransitionResponse,
  type ContactDraftResponse,
  type ListAttentionCasesResponse,
} from "@academic-precision/contracts";
import { ValidationApiException } from "../../common/exceptions/api.exception";
import { toFieldErrors } from "../../common/validation/zod-field-errors";
import { AttentionService } from "../application/attention.service";

/**
 * Thin controller — Phase 7 Attention Case endpoints (API Contract §9.7,
 * §11.13-11.14). All business/authorization logic lives in
 * `AttentionService`.
 */
@ApiTags("attention-cases")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PermissionGuard)
@Controller("attention-cases")
export class AttentionCasesController {
  constructor(private readonly attentionService: AttentionService) {}

  @Get()
  @RequirePermission("followup.read")
  @ApiOperation({ summary: "Unified active/history Attention Cases, cursor-paginated (GET /api/v1/attention-cases)" })
  listAttentionCases(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Query("status") status?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<ListAttentionCasesResponse> {
    return this.attentionService.listAttentionCases(user, workspaceContext, {
      status,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(":id")
  @RequirePermission("followup.read")
  @ApiOperation({ summary: "Attention Case detail — reasons/evidence/contact timeline (GET /api/v1/attention-cases/:id)" })
  getAttentionCase(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
  ): Promise<AttentionCase> {
    return this.attentionService.getAttentionCase(user, workspaceContext, id);
  }

  @Post(":id/start-followup")
  @RequirePermission("followup.write")
  @UseGuards(EntitlementGuard)
  @RequireEntitlement("CORE_OPERATIONS")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "New → In Follow-up (POST /api/v1/attention-cases/:id/start-followup)" })
  startFollowup(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<AttentionCaseTransitionResponse> {
    const parsed = attentionCaseTransitionRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.attentionService.startFollowup(user, workspaceContext, id, parsed.data, extractHeader(request, REQUEST_ID_HEADER));
  }

  @Post(":id/mark-monitoring")
  @RequirePermission("followup.write")
  @UseGuards(EntitlementGuard)
  @RequireEntitlement("CORE_OPERATIONS")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "→ Monitoring (POST /api/v1/attention-cases/:id/mark-monitoring)" })
  markMonitoring(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<AttentionCaseTransitionResponse> {
    const parsed = attentionCaseTransitionRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.attentionService.markMonitoring(user, workspaceContext, id, parsed.data, extractHeader(request, REQUEST_ID_HEADER));
  }

  @Post(":id/close")
  @RequirePermission("followup.write")
  @UseGuards(EntitlementGuard)
  @RequireEntitlement("CORE_OPERATIONS")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Close explicitly (POST /api/v1/attention-cases/:id/close)" })
  closeCase(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<AttentionCaseTransitionResponse> {
    const parsed = attentionCaseTransitionRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.attentionService.closeCase(user, workspaceContext, id, parsed.data, extractHeader(request, REQUEST_ID_HEADER));
  }

  @Post(":id/contact-draft")
  @RequirePermission("parent_contact")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Editable WhatsApp draft — deeplink only, never claims send/delivery (POST /api/v1/attention-cases/:id/contact-draft)" })
  contactDraft(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<ContactDraftResponse> {
    const parsed = contactDraftRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.attentionService.contactDraft(user, workspaceContext, id, parsed.data);
  }
}
