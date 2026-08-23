import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Patch, Query, Req, UseGuards } from "@nestjs/common";
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
import {
  createStudentRequestSchema,
  linkGuardianRequestSchema,
  matchPreviewRequestSchema,
  qrReissueRequestSchema,
  updateStudentGuardianRequestSchema,
  updateStudentRequestSchema,
  type CreateStudentRequest,
  type CreateStudentResponse,
  type GuardianLink,
  type LinkGuardianRequest,
  type ListStudentsResponse,
  type MatchPreviewRequest,
  type MatchPreviewResponse,
  type QrIssueResponse,
  type QrReissueRequest,
  type Student,
  type StudentDetailResponse,
  type UpdateStudentGuardianRequest,
  type UpdateStudentRequest,
} from "@academic-precision/contracts";
import { ValidationApiException } from "../../common/exceptions/api.exception";
import { toFieldErrors } from "../../common/validation/zod-field-errors";
import { StudentsService } from "../application/students.service";

/**
 * Thin controller — Phase 4 Students + Guardians + QR endpoints (API
 * Contract §9.5). All business/authorization logic lives in
 * `StudentsService`.
 */
@ApiTags("students")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PermissionGuard)
@Controller()
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Get("students")
  @RequirePermission("students.view_basic")
  @ApiOperation({ summary: "Scoped directory/search (GET /api/v1/students)" })
  listStudents(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Query("q") q?: string,
    @Query("searchBy") searchBy?: "name" | "code" | "guardianPhone",
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<ListStudentsResponse> {
    return this.studentsService.listStudents(user, workspaceContext, {
      q,
      searchBy,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post("students/match-preview")
  @RequirePermission("students.edit")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Possible-duplicate candidates; no side effects, no auto merge (POST /api/v1/students/match-preview)" })
  matchPreview(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Body() body: unknown,
  ): Promise<MatchPreviewResponse> {
    const parsed = matchPreviewRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.studentsService.matchPreview(user, workspaceContext, parsed.data as MatchPreviewRequest);
  }

  @Post("students")
  @RequirePermission("students.edit")
  @ApiOperation({ summary: "Create Student + guardian links + initial QR (POST /api/v1/students)" })
  createStudent(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<CreateStudentResponse> {
    const parsed = createStudentRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.studentsService.createStudent(
      user,
      workspaceContext,
      parsed.data as CreateStudentRequest,
      extractHeader(request, REQUEST_ID_HEADER),
    );
  }

  @Get("students/:id")
  @RequirePermission("students.view_basic")
  @ApiOperation({ summary: "Student 360-lite projection (GET /api/v1/students/:id)" })
  getStudent(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
  ): Promise<StudentDetailResponse> {
    return this.studentsService.getStudent(user, workspaceContext, id);
  }

  @Patch("students/:id")
  @RequirePermission("students.edit")
  @ApiOperation({ summary: "Versioned basic edit (PATCH /api/v1/students/:id)" })
  updateStudent(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<Student> {
    const parsed = updateStudentRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.studentsService.updateStudent(
      user,
      workspaceContext,
      id,
      parsed.data as UpdateStudentRequest,
      extractHeader(request, REQUEST_ID_HEADER),
    );
  }

  @Post("students/:id/archive")
  @RequirePermission("students.edit")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Archive; no hard delete (POST /api/v1/students/:id/archive)" })
  archiveStudent(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<Student> {
    return this.studentsService.archiveStudent(user, workspaceContext, id, extractHeader(request, REQUEST_ID_HEADER));
  }

  @Post("students/:id/guardians")
  @RequirePermission("students.edit")
  @ApiOperation({ summary: "Link/create a guardian (POST /api/v1/students/:id/guardians)" })
  linkGuardian(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<GuardianLink> {
    const parsed = linkGuardianRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.studentsService.linkGuardian(
      user,
      workspaceContext,
      id,
      parsed.data as LinkGuardianRequest,
      extractHeader(request, REQUEST_ID_HEADER),
    );
  }

  @Patch("students/:studentId/guardians/:guardianId")
  @RequirePermission("students.edit")
  @ApiOperation({ summary: "Edit relation/contact flags on the join row (PATCH .../guardians/:guardianId)" })
  updateStudentGuardian(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("studentId") studentId: string,
    @Param("guardianId") guardianId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<GuardianLink> {
    const parsed = updateStudentGuardianRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.studentsService.updateStudentGuardian(
      user,
      workspaceContext,
      studentId,
      guardianId,
      parsed.data as UpdateStudentGuardianRequest,
      extractHeader(request, REQUEST_ID_HEADER),
    );
  }

  @Post("students/:studentId/guardians/:guardianId/set-primary")
  @RequirePermission("students.edit")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Set one primary guardian (POST .../guardians/:guardianId/set-primary)" })
  setPrimaryGuardian(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("studentId") studentId: string,
    @Param("guardianId") guardianId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<GuardianLink> {
    return this.studentsService.setPrimaryGuardian(
      user,
      workspaceContext,
      studentId,
      guardianId,
      extractHeader(request, REQUEST_ID_HEADER),
    );
  }

  @Post("students/:id/qr/issue")
  @RequirePermission("students.edit")
  @ApiOperation({ summary: "Issue if no active QR (POST /api/v1/students/:id/qr/issue)" })
  issueQr(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<QrIssueResponse> {
    return this.studentsService.issueQr(user, workspaceContext, id, extractHeader(request, REQUEST_ID_HEADER));
  }

  @Post("students/:id/qr/reissue")
  @RequirePermission("students.edit")
  @ApiOperation({ summary: "Revoke old; audit; token once (POST /api/v1/students/:id/qr/reissue)" })
  reissueQr(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<QrIssueResponse> {
    const parsed = qrReissueRequestSchema.safeParse(body ?? {});
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.studentsService.reissueQr(
      user,
      workspaceContext,
      id,
      parsed.data as QrReissueRequest,
      extractHeader(request, REQUEST_ID_HEADER),
    );
  }
}
