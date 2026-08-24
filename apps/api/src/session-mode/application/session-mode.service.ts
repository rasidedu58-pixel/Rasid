import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type {
  AttendanceBatchRequest,
  AttendanceBatchResponse,
  BatchSummary,
  ExamDefinitionRequest,
  ExamDefinitionResponse,
  ExamScoresBatchRequest,
  ExamScoresBatchResponse,
  HomeworkBatchRequest,
  HomeworkBatchResponse,
  HomeworkBatchSummary,
  MarkAllDoneRequest,
  MarkAllPresentRequest,
  NoHomeworkRequest,
  Session,
  SessionCompleteRequest,
  SessionCompleteResponse,
  SessionReviewResponse,
  SessionRosterResponse,
  SessionStartResponse,
} from "@academic-precision/contracts";
import { deriveEligibleEnrollmentIds, deriveMissingRecords, VERSION_CONFLICT, type GroupMonthRow, type SessionExamRow, type SessionRecordRow, type SessionRow } from "@academic-precision/database";
import {
  BatchValidationFailedException,
  ExamScoreOutOfRangeException,
  IdempotencyConflictException,
  ResourceNotFoundException,
  SessionAlreadyCompletedException,
  SessionInvalidStateException,
  SessionRecordsMissingException,
  ValidationApiException,
  VersionConflictException,
} from "../../common/exceptions/api.exception";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import type { WorkspaceContext } from "../../team/api/guards/permission.guard";
import { PermissionResolverService } from "../../team/application/permission-resolver.service";
import { SESSION_MODE_REPOSITORY, type SessionModeRepositoryPort } from "./ports/session-mode-repository.port";

const IN_PROGRESS = "IN_PROGRESS";
const COMPLETED = "COMPLETED";
const COMPLETE_SESSION_OPERATION = "CompleteSession";

/**
 * Phase 5 Closure Delta: `complete_session_with_missing_records` is now a
 * real, stored global flag (`feature_flags` table, migration 0023 — default
 * `false`) read via `SessionModeRepositoryPort.findFeatureFlagEnabled`, NOT
 * a hardcoded constant. `computeReview` reads it exactly once per call and
 * is the ONLY place either `getReview` or `completeSession` consult it —
 * both endpoints funnel through this same method, so `canComplete` and the
 * completion gate can never disagree about the flag's value within one
 * request. No management/admin endpoint exists yet to change it (out of
 * this delta's scope) — only the read side is wired.
 */
const COMPLETE_SESSION_WITH_MISSING_RECORDS_FLAG_KEY = "complete_session_with_missing_records";
const COMPLETE_SESSION_WITH_MISSING_RECORDS_DEFAULT = false;

type ScopedPermission = "attendance.read" | "attendance.write" | "homework.write" | "exams.write" | "students.view_basic";

interface ReviewComputation {
  eligibleEnrollmentIds: string[];
  recordsByEnrollmentId: Map<string, SessionRecordRow>;
  attendanceSummary: BatchSummary;
  homeworkSummary: HomeworkBatchSummary;
  examSummary: { hasExam: boolean; scored: number; absent: number; missing: number };
  missingRecords: SessionReviewResponse["missingRecords"];
  canComplete: boolean;
  blockingReasons: string[];
}

/**
 * Application service for Phase 5 Session Mode endpoints (Start / Roster /
 * Attendance / Homework / Exam / Review / Complete). Controllers stay thin;
 * all authorization/business rules live here, mirroring the Phase 1-4
 * convention.
 *
 * Every mutating endpoint (start/attendance/homework/exam-scores/mark-all-*)
 * shares ONE optimistic-concurrency counter — `sessions.version` — bumped
 * exactly once per call by `packages/database`'s
 * `withSessionVersionGuard`-backed transactions; a stale `sessionVersion`/
 * `version` is always `VERSION_CONFLICT`, never a silent overwrite.
 * `session_exams` carries its own independent `version` (exam definition is
 * a separate concurrency track from record-taking).
 */
@Injectable()
export class SessionModeService {
  constructor(
    @Inject(SESSION_MODE_REPOSITORY) private readonly repository: SessionModeRepositoryPort,
    private readonly permissionResolver: PermissionResolverService,
  ) {}

  // ---------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------

  async startSession(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    id: string,
    body: { version: number },
    correlationId: string | null,
  ): Promise<SessionStartResponse> {
    const { session: before } = await this.loadSessionInScope(authUser, workspaceContext, id, "attendance.write");

    const result = await this.repository.startSessionTransaction({ sessionId: id, expectedVersion: body.version });
    if (result === VERSION_CONFLICT) {
      throw new VersionConflictException(undefined, { currentVersion: before.version });
    }
    if ("kind" in result) {
      throw new SessionInvalidStateException(undefined, { currentStatus: result.status });
    }

    await this.repository.insertAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      actorUserId: authUser.id,
      actorMembershipId: workspaceContext.membership.id,
      action: "session.started",
      entityType: "session",
      entityId: result.id,
      beforeJson: { status: before.status },
      afterJson: { status: result.status },
      correlationId,
    });

    return { session: this.toSessionDto(result) };
  }

  // ---------------------------------------------------------------------
  // Roster
  // ---------------------------------------------------------------------

  async getRoster(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    id: string,
  ): Promise<SessionRosterResponse> {
    const { session, groupMonth } = await this.loadSessionInScope(authUser, workspaceContext, id, "students.view_basic");
    const workspaceTimezone = await this.requireWorkspaceTimezone(workspaceContext.workspaceId);

    const allEnrollments = await this.repository.listEnrollmentsForRoster(groupMonth.id);
    const eligibleIds = new Set(
      deriveEligibleEnrollmentIds({
        enrollments: allEnrollments,
        sessionScheduledAt: session.scheduledAt,
        workspaceTimezone,
      }),
    );
    const eligible = allEnrollments.filter((e) => eligibleIds.has(e.enrollmentId));

    const records = await this.repository.findSessionRecordsForSession(id);
    const recordsByEnrollmentId = new Map(records.map((r) => [r.enrollmentId, r]));

    const students = eligible
      .map((e) => {
        const record = recordsByEnrollmentId.get(e.enrollmentId);
        return {
          enrollmentId: e.enrollmentId,
          studentId: e.studentId,
          studentName: e.studentName,
          studentCode: e.studentCode,
          record: this.toRecordDto(record),
          version: record?.version ?? 0,
        };
      })
      .sort((a, b) => a.studentName.localeCompare(b.studentName, "ar"));

    return { session: this.toSessionDto(session), students };
  }

  // ---------------------------------------------------------------------
  // Attendance
  // ---------------------------------------------------------------------

  async putAttendance(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    id: string,
    body: AttendanceBatchRequest,
  ): Promise<AttendanceBatchResponse> {
    const { groupMonth } = await this.loadSessionInScope(authUser, workspaceContext, id, "attendance.write");

    const result = await this.repository.applyAttendanceBatchTransaction({
      sessionId: id,
      workspaceId: workspaceContext.workspaceId,
      groupMonthId: groupMonth.id,
      expectedVersion: body.sessionVersion,
      records: body.records,
      actorUserId: authUser.id,
    });
    this.assertNotBatchFailure(result);

    return this.buildAttendanceResponse(result.session, groupMonth, body.records.length);
  }

  async markAllPresent(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    id: string,
    body: MarkAllPresentRequest,
  ): Promise<AttendanceBatchResponse> {
    const { session, groupMonth } = await this.loadSessionInScope(authUser, workspaceContext, id, "attendance.write");
    const eligibleIds = await this.getEligibleEnrollmentIds(session, groupMonth, workspaceContext.workspaceId);

    const result = await this.repository.applyAttendanceBatchTransaction({
      sessionId: id,
      workspaceId: workspaceContext.workspaceId,
      groupMonthId: groupMonth.id,
      expectedVersion: body.sessionVersion,
      records: eligibleIds.map((enrollmentId) => ({ enrollmentId, status: "PRESENT" as const })),
      actorUserId: authUser.id,
    });
    this.assertNotBatchFailure(result);

    return this.buildAttendanceResponse(result.session, groupMonth, eligibleIds.length);
  }

  // ---------------------------------------------------------------------
  // Homework
  // ---------------------------------------------------------------------

  async putHomework(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    id: string,
    body: HomeworkBatchRequest,
  ): Promise<HomeworkBatchResponse> {
    const { groupMonth } = await this.loadSessionInScope(authUser, workspaceContext, id, "homework.write");

    const result = await this.repository.applyHomeworkBatchTransaction({
      sessionId: id,
      workspaceId: workspaceContext.workspaceId,
      groupMonthId: groupMonth.id,
      expectedVersion: body.sessionVersion,
      records: body.records,
      actorUserId: authUser.id,
    });
    this.assertNotBatchFailure(result);

    return this.buildHomeworkResponse(result.session, groupMonth, body.records.length);
  }

  async markAllDone(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    id: string,
    body: MarkAllDoneRequest,
  ): Promise<HomeworkBatchResponse> {
    const { session, groupMonth } = await this.loadSessionInScope(authUser, workspaceContext, id, "homework.write");
    const eligibleIds = await this.getEligibleEnrollmentIds(session, groupMonth, workspaceContext.workspaceId);

    const result = await this.repository.applyHomeworkBatchTransaction({
      sessionId: id,
      workspaceId: workspaceContext.workspaceId,
      groupMonthId: groupMonth.id,
      expectedVersion: body.sessionVersion,
      records: eligibleIds.map((enrollmentId) => ({ enrollmentId, status: "DONE" as const })),
      actorUserId: authUser.id,
    });
    this.assertNotBatchFailure(result);

    return this.buildHomeworkResponse(result.session, groupMonth, eligibleIds.length);
  }

  async noHomework(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    id: string,
    body: NoHomeworkRequest,
  ): Promise<HomeworkBatchResponse> {
    const { session, groupMonth } = await this.loadSessionInScope(authUser, workspaceContext, id, "homework.write");
    const eligibleIds = await this.getEligibleEnrollmentIds(session, groupMonth, workspaceContext.workspaceId);

    const result = await this.repository.applyHomeworkBatchTransaction({
      sessionId: id,
      workspaceId: workspaceContext.workspaceId,
      groupMonthId: groupMonth.id,
      expectedVersion: body.sessionVersion,
      records: eligibleIds.map((enrollmentId) => ({ enrollmentId, status: "NO_HOMEWORK" as const })),
      actorUserId: authUser.id,
    });
    this.assertNotBatchFailure(result);

    return this.buildHomeworkResponse(result.session, groupMonth, eligibleIds.length);
  }

  // ---------------------------------------------------------------------
  // Exam
  // ---------------------------------------------------------------------

  async putExamDefinition(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    id: string,
    body: ExamDefinitionRequest,
  ): Promise<ExamDefinitionResponse> {
    await this.loadSessionInScope(authUser, workspaceContext, id, "exams.write");
    const existing = await this.repository.findSessionExamBySessionId(id);

    if (!body.hasExam) {
      if (existing) {
        // Removing an already-defined exam is not a documented flow (the
        // API Contract only shows the "define" path) — rejected explicitly
        // rather than inventing delete/disable semantics.
        throw new ValidationApiException({
          hasExam: ["لا يمكن إلغاء اختبار مُعرَّف بالفعل لهذه الحصة."],
        });
      }
      return { hasExam: false, name: null, maxScore: null, lowScoreThreshold: null, version: null };
    }

    if (body.maxScore === undefined) {
      throw new ValidationApiException({ maxScore: ["مطلوب عند تفعيل الاختبار."] });
    }
    if (existing && body.version === undefined) {
      throw new ValidationApiException({ version: ["مطلوب عند تعديل اختبار موجود بالفعل."] });
    }

    const result = await this.repository.upsertSessionExamTransaction({
      workspaceId: workspaceContext.workspaceId,
      sessionId: id,
      name: body.name ?? null,
      maxScore: body.maxScore,
      lowScoreThreshold: body.lowScoreThreshold ?? null,
      expectedVersion: existing ? body.version : undefined,
    });
    if (result === VERSION_CONFLICT) {
      throw new VersionConflictException(undefined, { currentVersion: existing?.version });
    }

    return this.toExamDefinitionDto(result);
  }

  async putExamScores(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    id: string,
    body: ExamScoresBatchRequest,
  ): Promise<ExamScoresBatchResponse> {
    const { groupMonth } = await this.loadSessionInScope(authUser, workspaceContext, id, "exams.write");

    const result = await this.repository.applyExamScoresBatchTransaction({
      sessionId: id,
      workspaceId: workspaceContext.workspaceId,
      groupMonthId: groupMonth.id,
      expectedVersion: body.sessionVersion,
      records: body.records,
      actorUserId: authUser.id,
    });

    if (result === VERSION_CONFLICT) throw new VersionConflictException();
    if ("kind" in result) {
      if (result.kind === "INVALID_STATE") throw new SessionInvalidStateException(undefined, { currentStatus: result.status });
      if (result.kind === "INVALID_ENROLLMENT") throw new BatchValidationFailedException(undefined, { invalidEnrollmentIds: result.ids });
      if (result.kind === "EXAM_NOT_DEFINED") {
        throw new ValidationApiException({ _root: ["لم يتم تعريف اختبار لهذه الحصة بعد."] });
      }
      throw new ExamScoreOutOfRangeException(undefined, { enrollmentId: result.enrollmentId });
    }

    return { sessionVersion: result.session.version, updated: body.records.length };
  }

  // ---------------------------------------------------------------------
  // Review
  // ---------------------------------------------------------------------

  async getReview(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    id: string,
  ): Promise<SessionReviewResponse> {
    // Phase 5 Closure Delta item 3: was "groups.view" (mirroring Phase 3's
    // generic "Scoped read" precedent) — re-examined against PRD §35's own
    // worked persona ("مساعد سنتر: scope=Group A؛ attendance.write,
    // payments.record, students.view_basic" — no groups.view granted at
    // all), which would leave that exact assistant unable to review their
    // own session before completing it, even though their attendance.write
    // grant already gates /start and /complete. "attendance.read" (implied
    // by attendance.write via the catalog's own dependency closure) is the
    // correct existing-catalog key — no new permission invented.
    const { session, groupMonth } = await this.loadSessionInScope(authUser, workspaceContext, id, "attendance.read");
    const review = await this.computeReview(session, groupMonth, workspaceContext.workspaceId);
    return {
      attendanceSummary: review.attendanceSummary,
      homeworkSummary: review.homeworkSummary,
      examSummary: review.examSummary,
      missingRecords: review.missingRecords,
      canComplete: review.canComplete,
      blockingReasons: review.blockingReasons,
    };
  }

  // ---------------------------------------------------------------------
  // Complete
  // ---------------------------------------------------------------------

  async completeSession(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    id: string,
    idempotencyKey: string | null,
    body: SessionCompleteRequest,
    correlationId: string | null,
  ): Promise<SessionCompleteResponse> {
    if (!idempotencyKey) {
      throw new ValidationApiException({ "Idempotency-Key": ["مطلوب لإنهاء الحصة."] });
    }
    const { session: before, groupMonth } = await this.loadSessionInScope(authUser, workspaceContext, id, "attendance.write");

    const requestHash = createHash("sha256").update(JSON.stringify({ sessionId: id, version: body.version })).digest("hex");
    const existingRecord = await this.repository.findIdempotencyRecord(
      workspaceContext.workspaceId,
      COMPLETE_SESSION_OPERATION,
      idempotencyKey,
    );
    if (existingRecord) {
      if (existingRecord.requestHash !== requestHash) {
        throw new IdempotencyConflictException();
      }
      if (existingRecord.status === "COMPLETED" && existingRecord.responsePayload) {
        // Second completion never re-runs effects — cached response only.
        return existingRecord.responsePayload as SessionCompleteResponse;
      }
    }

    if (before.status === COMPLETED && !existingRecord) {
      throw new SessionAlreadyCompletedException();
    }

    const review = await this.computeReview(before, groupMonth, workspaceContext.workspaceId);
    if (!review.canComplete) {
      throw new SessionRecordsMissingException(undefined, {
        missingRecords: review.missingRecords,
        blockingReasons: review.blockingReasons,
      });
    }
    // PRD §34: "If True [complete_session_with_missing_records]: confirmation
    // + gaps remain in Missing Records + AuditEvent." `review.canComplete`
    // can be true DESPITE `missingRecords` being non-empty when the flag is
    // enabled (computeReview never hides gaps behind the flag — only
    // whether they BLOCK completion) — that combination is exactly
    // "completed with gaps" and gets flagged in the audit event below.
    const completedWithGaps = review.missingRecords.length > 0;

    const idempotencyRow =
      existingRecord ??
      (await this.repository.tryInsertIdempotencyRecord({
        workspaceId: workspaceContext.workspaceId,
        operation: COMPLETE_SESSION_OPERATION,
        key: idempotencyKey,
        requestHash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })) ??
      (await this.repository.findIdempotencyRecord(workspaceContext.workspaceId, COMPLETE_SESSION_OPERATION, idempotencyKey));

    if (!idempotencyRow) {
      throw new ValidationApiException({ _root: ["تعذر تسجيل مفتاح idempotency."] });
    }
    if (idempotencyRow.requestHash !== requestHash) {
      throw new IdempotencyConflictException();
    }
    if (idempotencyRow.status === "COMPLETED" && idempotencyRow.responsePayload) {
      return idempotencyRow.responsePayload as SessionCompleteResponse;
    }

    const result = await this.repository.completeSessionTransaction({ sessionId: id, expectedVersion: body.version });
    if (result === VERSION_CONFLICT) {
      await this.repository.failIdempotencyRecord(idempotencyRow.id);
      throw new VersionConflictException(undefined, { currentVersion: before.version });
    }
    if ("kind" in result) {
      await this.repository.failIdempotencyRecord(idempotencyRow.id);
      throw new SessionInvalidStateException(undefined, { currentStatus: result.status });
    }

    const response: SessionCompleteResponse = { session: this.toSessionDto(result) };

    await this.repository.insertAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      actorUserId: authUser.id,
      actorMembershipId: workspaceContext.membership.id,
      action: "session.completed",
      entityType: "session",
      entityId: result.id,
      beforeJson: { status: before.status },
      afterJson: completedWithGaps
        ? { status: result.status, completedWithGaps: true, missingRecords: review.missingRecords }
        : { status: result.status },
      correlationId,
    });

    await this.repository.completeIdempotencyRecord(idempotencyRow.id, 200, response);

    return response;
  }

  // ---------------------------------------------------------------------
  // Review computation (shared by getReview + completeSession)
  // ---------------------------------------------------------------------

  private async computeReview(
    session: SessionRow,
    groupMonth: GroupMonthRow,
    workspaceId: string,
  ): Promise<ReviewComputation> {
    const workspaceTimezone = await this.requireWorkspaceTimezone(workspaceId);
    const allEnrollments = await this.repository.listEnrollmentsForRoster(groupMonth.id);
    const eligibleEnrollmentIds = deriveEligibleEnrollmentIds({
      enrollments: allEnrollments,
      sessionScheduledAt: session.scheduledAt,
      workspaceTimezone,
    });
    const enrollmentById = new Map(allEnrollments.map((e) => [e.enrollmentId, e]));

    const records = await this.repository.findSessionRecordsForSession(session.id);
    const recordsByEnrollmentId = new Map(records.map((r) => [r.enrollmentId, r]));
    const exam = await this.repository.findSessionExamBySessionId(session.id);

    // Phase 9 Closure correction: the missing-records rule itself now lives
    // in ONE place — `packages/database/src/session-mode/missing-records.ts`
    // — reused verbatim by `reports`/`action-center` rather than being
    // reimplemented (or, worse, approximated as "session overdue").
    const { missingRecords, attendanceSummary, homeworkSummary } = deriveMissingRecords({
      eligibleEnrollmentIds,
      recordsByEnrollmentId,
      studentNameByEnrollmentId: new Map(
        [...enrollmentById.entries()].map(([id, enrollment]) => [id, enrollment.studentName]),
      ),
    });
    const examSummary = { hasExam: !!exam, scored: 0, absent: 0, missing: 0 };
    for (const enrollmentId of eligibleEnrollmentIds) {
      // Exam is entirely OPTIONAL — never contributes to `missing`/canComplete — kept as its own pass, deliberately outside the shared missing-records function.
      if (!exam) continue;
      const record = recordsByEnrollmentId.get(enrollmentId);
      if (record?.examStatus === "SCORED") examSummary.scored += 1;
      else if (record?.examStatus === "ABSENT_FROM_EXAM") examSummary.absent += 1;
      else examSummary.missing += 1;
    }

    // Single source of truth: both getReview and completeSession call THIS
    // method, and this is the only place the flag is read — they can never
    // disagree about its value within one request.
    const allowMissingRecords =
      (await this.repository.findFeatureFlagEnabled(COMPLETE_SESSION_WITH_MISSING_RECORDS_FLAG_KEY)) ??
      COMPLETE_SESSION_WITH_MISSING_RECORDS_DEFAULT;

    const blockingReasons: string[] = [];
    if (session.status !== IN_PROGRESS) blockingReasons.push("SESSION_NOT_IN_PROGRESS");
    if (!allowMissingRecords && missingRecords.length > 0) {
      blockingReasons.push("SESSION_RECORDS_MISSING");
    }

    return {
      eligibleEnrollmentIds,
      recordsByEnrollmentId,
      attendanceSummary,
      homeworkSummary,
      examSummary,
      missingRecords,
      canComplete: blockingReasons.length === 0,
      blockingReasons,
    };
  }

  private async getEligibleEnrollmentIds(
    session: SessionRow,
    groupMonth: GroupMonthRow,
    workspaceId: string,
  ): Promise<string[]> {
    const workspaceTimezone = await this.requireWorkspaceTimezone(workspaceId);
    const allEnrollments = await this.repository.listEnrollmentsForRoster(groupMonth.id);
    return deriveEligibleEnrollmentIds({
      enrollments: allEnrollments,
      sessionScheduledAt: session.scheduledAt,
      workspaceTimezone,
    });
  }

  private async buildAttendanceResponse(
    session: SessionRow,
    groupMonth: GroupMonthRow,
    updated: number,
  ): Promise<AttendanceBatchResponse> {
    const review = await this.computeReview(session, groupMonth, session.workspaceId);
    return { sessionVersion: session.version, updated, summary: review.attendanceSummary };
  }

  private async buildHomeworkResponse(
    session: SessionRow,
    groupMonth: GroupMonthRow,
    updated: number,
  ): Promise<HomeworkBatchResponse> {
    const review = await this.computeReview(session, groupMonth, session.workspaceId);
    return { sessionVersion: session.version, updated, summary: review.homeworkSummary };
  }

  private assertNotBatchFailure<T extends { session: SessionRow }>(
    result: T | typeof VERSION_CONFLICT | { kind: "INVALID_STATE"; status: string } | { kind: "INVALID_ENROLLMENT"; ids: string[] },
  ): asserts result is T {
    if (result === VERSION_CONFLICT) throw new VersionConflictException();
    if (typeof result === "object" && "kind" in result) {
      if (result.kind === "INVALID_STATE") {
        throw new SessionInvalidStateException(undefined, { currentStatus: result.status });
      }
      throw new BatchValidationFailedException(undefined, { invalidEnrollmentIds: result.ids });
    }
  }

  // ---------------------------------------------------------------------
  // Scope helpers
  // ---------------------------------------------------------------------

  private async loadSessionInScope(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    sessionId: string,
    permission: ScopedPermission,
  ): Promise<{ session: SessionRow; groupMonth: GroupMonthRow }> {
    const session = await this.repository.findSessionById(sessionId);
    if (!session || session.workspaceId !== workspaceContext.workspaceId) {
      throw new ResourceNotFoundException();
    }
    const groupMonth = await this.repository.findGroupMonthById(session.groupMonthId);
    if (!groupMonth) {
      throw new ResourceNotFoundException();
    }
    const inScope = await this.permissionResolver.isGroupInScope(
      workspaceContext.workspaceId,
      authUser.id,
      permission,
      groupMonth.groupId,
    );
    if (!inScope) {
      throw new ResourceNotFoundException();
    }
    return { session, groupMonth };
  }

  private async requireWorkspaceTimezone(workspaceId: string): Promise<string> {
    const timezone = await this.repository.findWorkspaceTimezone(workspaceId);
    if (!timezone) {
      throw new ValidationApiException({ _root: ["تعذر تحديد المنطقة الزمنية لمساحة العمل."] });
    }
    return timezone;
  }

  // ---------------------------------------------------------------------
  // DTO mappers
  // ---------------------------------------------------------------------

  private toSessionDto(row: SessionRow): Session {
    return {
      id: row.id,
      groupMonthId: row.groupMonthId,
      scheduledAt: row.scheduledAt.toISOString(),
      durationMinutes: row.durationMinutes,
      status: row.status as Session["status"],
      origin: row.origin as Session["origin"],
      rescheduledFromSessionId: row.rescheduledFromSessionId,
      billableForProration: row.billableForProration,
      version: row.version,
    };
  }

  private toRecordDto(row: SessionRecordRow | undefined) {
    return {
      attendance: (row?.attendanceStatus as "PRESENT" | "ABSENT" | "LATE" | null) ?? null,
      homework: (row?.homeworkStatus as "DONE" | "PARTIAL" | "NOT_DONE" | "NO_HOMEWORK" | null) ?? null,
      examStatus: (row?.examStatus as "NO_EXAM" | "SCORED" | "ABSENT_FROM_EXAM") ?? "NO_EXAM",
      examScore: row?.examScore === undefined || row.examScore === null ? null : Number(row.examScore),
    };
  }

  private toExamDefinitionDto(row: SessionExamRow): ExamDefinitionResponse {
    return {
      hasExam: true,
      name: row.name,
      maxScore: Number(row.maxScore),
      lowScoreThreshold: row.lowScoreThreshold === null ? null : Number(row.lowScoreThreshold),
      version: row.version,
    };
  }
}
