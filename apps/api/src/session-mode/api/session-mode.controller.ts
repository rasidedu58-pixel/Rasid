import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
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
  attendanceBatchRequestSchema,
  examDefinitionRequestSchema,
  examScoresBatchRequestSchema,
  homeworkBatchRequestSchema,
  markAllDoneRequestSchema,
  markAllPresentRequestSchema,
  noHomeworkRequestSchema,
  sessionCompleteRequestSchema,
  type AttendanceBatchRequest,
  type AttendanceBatchResponse,
  type ExamDefinitionRequest,
  type ExamDefinitionResponse,
  type ExamScoresBatchRequest,
  type ExamScoresBatchResponse,
  type HomeworkBatchRequest,
  type HomeworkBatchResponse,
  type MarkAllDoneRequest,
  type MarkAllPresentRequest,
  type NoHomeworkRequest,
  type SessionCompleteRequest,
  type SessionCompleteResponse,
  type SessionReviewResponse,
  type SessionRosterResponse,
  type SessionStartResponse,
} from "@academic-precision/contracts";
import { ValidationApiException } from "../../common/exceptions/api.exception";
import { toFieldErrors } from "../../common/validation/zod-field-errors";
import { SessionModeService } from "../application/session-mode.service";

const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

/**
 * Thin controller — Phase 5 Session Mode endpoints (API Contract §9.4).
 * Registered on the SAME `sessions` base path as Phase 3's
 * `SessionsController` (list/detail/cancel/reschedule) but in a separate
 * module — every route here is a distinct sub-path (`:id/start`,
 * `:id/roster`, `:id/attendance`, ...), so there is no collision. All
 * business/authorization logic lives in `SessionModeService`.
 */
@ApiTags("session-mode")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PermissionGuard)
@Controller("sessions")
export class SessionModeController {
  constructor(private readonly sessionModeService: SessionModeService) {}

  @Post(":id/start")
  @RequirePermission("attendance.write")
  @ApiOperation({ summary: "SCHEDULED→IN_PROGRESS (POST /api/v1/sessions/:id/start)" })
  start(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<SessionStartResponse> {
    const parsed = sessionCompleteRequestSchema.safeParse(body); // same shape: { version: number }
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.sessionModeService.startSession(
      user,
      workspaceContext,
      id,
      parsed.data,
      extractHeader(request, REQUEST_ID_HEADER),
    );
  }

  @Get(":id/roster")
  @RequirePermission("students.view_basic")
  @ApiOperation({ summary: "Eligible enrollments only (GET /api/v1/sessions/:id/roster)" })
  roster(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
  ): Promise<SessionRosterResponse> {
    return this.sessionModeService.getRoster(user, workspaceContext, id);
  }

  @Put(":id/attendance")
  @RequirePermission("attendance.write")
  @ApiOperation({ summary: "Atomic batch attendance (PUT /api/v1/sessions/:id/attendance)" })
  putAttendance(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<AttendanceBatchResponse> {
    const parsed = attendanceBatchRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.sessionModeService.putAttendance(user, workspaceContext, id, parsed.data as AttendanceBatchRequest);
  }

  @Post(":id/attendance/mark-all-present")
  @RequirePermission("attendance.write")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Bulk command (POST /api/v1/sessions/:id/attendance/mark-all-present)" })
  markAllPresent(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<AttendanceBatchResponse> {
    const parsed = markAllPresentRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.sessionModeService.markAllPresent(user, workspaceContext, id, parsed.data as MarkAllPresentRequest);
  }

  @Put(":id/homework")
  @RequirePermission("homework.write")
  @ApiOperation({ summary: "Atomic batch homework (PUT /api/v1/sessions/:id/homework)" })
  putHomework(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<HomeworkBatchResponse> {
    const parsed = homeworkBatchRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.sessionModeService.putHomework(user, workspaceContext, id, parsed.data as HomeworkBatchRequest);
  }

  @Post(":id/homework/mark-all-done")
  @RequirePermission("homework.write")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Bulk command (POST /api/v1/sessions/:id/homework/mark-all-done)" })
  markAllDone(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<HomeworkBatchResponse> {
    const parsed = markAllDoneRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.sessionModeService.markAllDone(user, workspaceContext, id, parsed.data as MarkAllDoneRequest);
  }

  @Post(":id/homework/no-homework")
  @RequirePermission("homework.write")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Resolved no-homework state (POST /api/v1/sessions/:id/homework/no-homework)" })
  noHomework(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<HomeworkBatchResponse> {
    const parsed = noHomeworkRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.sessionModeService.noHomework(user, workspaceContext, id, parsed.data as NoHomeworkRequest);
  }

  @Put(":id/exam")
  @RequirePermission("exams.write")
  @ApiOperation({ summary: "Define optional exam (PUT /api/v1/sessions/:id/exam)" })
  putExam(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<ExamDefinitionResponse> {
    const parsed = examDefinitionRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.sessionModeService.putExamDefinition(user, workspaceContext, id, parsed.data as ExamDefinitionRequest);
  }

  @Put(":id/exam/scores")
  @RequirePermission("exams.write")
  @ApiOperation({ summary: "Atomic batch scores/absence (PUT /api/v1/sessions/:id/exam/scores)" })
  putExamScores(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<ExamScoresBatchResponse> {
    const parsed = examScoresBatchRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.sessionModeService.putExamScores(user, workspaceContext, id, parsed.data as ExamScoresBatchRequest);
  }

  @Get(":id/review")
  @RequirePermission("groups.view")
  @ApiOperation({ summary: "Server-computed canComplete/missing (GET /api/v1/sessions/:id/review)" })
  review(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
  ): Promise<SessionReviewResponse> {
    return this.sessionModeService.getReview(user, workspaceContext, id);
  }

  @Post(":id/complete")
  @RequirePermission("attendance.write")
  @ApiOperation({ summary: "Idempotent completion transaction (POST /api/v1/sessions/:id/complete)" })
  complete(
    @CurrentUser() user: VerifiedSupabaseToken,
    @CurrentWorkspaceContext() workspaceContext: WorkspaceContext,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<SessionCompleteResponse> {
    const parsed = sessionCompleteRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationApiException(toFieldErrors(parsed.error));
    return this.sessionModeService.completeSession(
      user,
      workspaceContext,
      id,
      extractHeader(request, IDEMPOTENCY_KEY_HEADER),
      parsed.data as SessionCompleteRequest,
      extractHeader(request, REQUEST_ID_HEADER),
    );
  }
}
