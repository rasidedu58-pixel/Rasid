import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { SupabaseAuthGuard } from "../../identity/api/guards/supabase-auth.guard";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import { CurrentUser } from "../../identity/api/decorators/current-user.decorator";
import { CurrentWorkspaceContext } from "../../team/api/decorators/current-workspace-context.decorator";
import { PermissionGuard, type WorkspaceContext } from "../../team/api/guards/permission.guard";
import { EntitlementGuard } from "../../billing/api/guards/entitlement.guard";
import { RequireEntitlement } from "../../billing/api/decorators/require-entitlement.decorator";
import { createContactLogRequestSchema, type CreateContactLogResponse } from "@academic-precision/contracts";
import { ValidationApiException } from "../../common/exceptions/api.exception";
import { toFieldErrors } from "../../common/validation/zod-field-errors";
import { AttentionService } from "../application/attention.service";

/**
 * Thin controller — Phase 7 `POST /contact-logs` (API Contract §9.7,
 * §11.14). Permission = `parent_contact/followup.write` (an OR gate — no
 * single `@RequirePermission` key expresses this, so it's deliberately
 * OMITTED here, matching `FinanceModule`'s own `/finance/collection-queue`
 * convention: `PermissionGuard` still requires an active membership, and
 * `AttentionService.createContactLog` does the OR-scope check manually.
 */
@ApiTags("contact-logs")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PermissionGuard)
@Controller("contact-logs")
export class ContactLogsController {
  constructor(private readonly attentionService: AttentionService) {}

  @Post()
  @UseGuards(EntitlementGuard)
  @RequireEntitlement("CORE_OPERATIONS")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Persist selected guardian + outcome + optional due date (POST /api/v1/contact-logs)" })
  createContactLog(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Body() body: unknown,
  ): Promise<CreateContactLogResponse> {
    const parsed = createContactLogRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.attentionService.createContactLog(user, workspaceContext, parsed.data);
  }
}
