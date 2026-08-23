import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { SupabaseAuthGuard } from "../../identity/api/guards/supabase-auth.guard";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import { CurrentUser } from "../../identity/api/decorators/current-user.decorator";
import { CurrentWorkspaceContext } from "../../team/api/decorators/current-workspace-context.decorator";
import { RequirePermission } from "../../team/api/decorators/require-permission.decorator";
import { PermissionGuard, type WorkspaceContext } from "../../team/api/guards/permission.guard";
import {
  qrResolveRequestSchema,
  type QrResolveRequest,
  type QrResolveResponse,
} from "@academic-precision/contracts";
import { ValidationApiException } from "../../common/exceptions/api.exception";
import { toFieldErrors } from "../../common/validation/zod-field-errors";
import { StudentsService } from "../application/students.service";

/**
 * Thin controller — `POST /api/v1/qr/resolve` (API Contract §9.5).
 * Gated on `students.view_basic` (the registry's "Context permission",
 * narrowed to the one context Phase 4 actually implements — see
 * `StudentsService.resolveQr`'s doc comment for why SESSION/PAYMENT are
 * explicitly rejected rather than silently no-op'd).
 */
@ApiTags("qr")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PermissionGuard)
@Controller("qr")
export class QrController {
  constructor(private readonly studentsService: StudentsService) {}

  @Post("resolve")
  @RequirePermission("students.view_basic")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Safe-no-leak QR resolve, GLOBAL context only in Phase 4 (POST /api/v1/qr/resolve)" })
  resolve(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Body() body: unknown,
  ): Promise<QrResolveResponse> {
    const parsed = qrResolveRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.studentsService.resolveQr(user, workspaceContext, parsed.data as QrResolveRequest);
  }
}
