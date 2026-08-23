import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { SupabaseAuthGuard } from "../../identity/api/guards/supabase-auth.guard";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import { CurrentUser } from "../../identity/api/decorators/current-user.decorator";
import { CurrentWorkspaceContext } from "../../team/api/decorators/current-workspace-context.decorator";
import { RequirePermission } from "../../team/api/decorators/require-permission.decorator";
import { PermissionGuard, type WorkspaceContext } from "../../team/api/guards/permission.guard";
import type { StudentObligationsResponse } from "@academic-precision/contracts";
import { FinanceService } from "../application/finance.service";

/**
 * Thin controller — `GET /students/:id/obligations` (API Contract §9.6).
 * Registered on the SAME `students` base path as Phase 4's
 * `StudentsController`/`QrController` but in the Finance module — a
 * distinct sub-path (`:id/obligations`), so there is no route collision.
 */
@ApiTags("finance")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PermissionGuard)
@Controller("students")
export class StudentObligationsController {
  constructor(private readonly financeService: FinanceService) {}

  @Get(":id/obligations")
  @RequirePermission("payments.view_student_status")
  @ApiOperation({ summary: "Month-separated obligations (GET /api/v1/students/:id/obligations)" })
  obligations(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
  ): Promise<StudentObligationsResponse> {
    return this.financeService.getStudentObligations(user, workspaceContext, id);
  }
}
