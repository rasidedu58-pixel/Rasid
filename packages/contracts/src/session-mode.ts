import { z } from "zod";
import { sessionSchema } from "./scheduling";

/**
 * Session Mode contract types — Phase 5, API Contract v1.0 §9.4, §11.5-11.8.
 * Shared between apps/api (producer) and apps/web (consumer).
 *
 * `followUpCandidates`/`projectionStatus` from the API Contract's §11.8
 * illustrative `POST /sessions/{id}/complete` example are deliberately
 * OMITTED from `sessionCompleteResponseSchema` — they describe the
 * Attention Engine's downstream output, which is explicitly out of Phase 5
 * scope (prohibited list). Mirrors the Phase 4 precedent of omitting
 * `obligation` from `EnrollmentCreateResponse` for the same reason (a field
 * describing a not-yet-implemented later phase is more honest omitted than
 * included with a fabricated always-empty value).
 */

// ---------------------------------------------------------------------------
// Record status enums
// ---------------------------------------------------------------------------

export const attendanceStatusSchema = z.enum(["PRESENT", "ABSENT", "LATE"]);
export type AttendanceStatus = z.infer<typeof attendanceStatusSchema>;

export const homeworkStatusSchema = z.enum(["DONE", "PARTIAL", "NOT_DONE", "NO_HOMEWORK"]);
export type HomeworkStatus = z.infer<typeof homeworkStatusSchema>;

export const examStatusSchema = z.enum(["NO_EXAM", "SCORED", "ABSENT_FROM_EXAM"]);
export type ExamStatus = z.infer<typeof examStatusSchema>;

export const sessionRecordSchema = z.object({
  attendance: attendanceStatusSchema.nullable(),
  homework: homeworkStatusSchema.nullable(),
  examStatus: examStatusSchema,
  examScore: z.number().nullable(),
});
export type SessionRecordDto = z.infer<typeof sessionRecordSchema>;

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

export const sessionStartResponseSchema = z.object({ session: sessionSchema });
export type SessionStartResponse = z.infer<typeof sessionStartResponseSchema>;

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

export const rosterStudentSchema = z.object({
  enrollmentId: z.string().uuid(),
  studentId: z.string().uuid(),
  studentName: z.string(),
  studentCode: z.string(),
  record: sessionRecordSchema,
  version: z.number().int(),
});
export type RosterStudent = z.infer<typeof rosterStudentSchema>;

export const sessionRosterResponseSchema = z.object({
  session: sessionSchema,
  students: z.array(rosterStudentSchema),
});
export type SessionRosterResponse = z.infer<typeof sessionRosterResponseSchema>;

// ---------------------------------------------------------------------------
// Attendance batch
// ---------------------------------------------------------------------------

export const attendanceBatchRecordSchema = z.object({
  enrollmentId: z.string().uuid(),
  status: attendanceStatusSchema,
});
export type AttendanceBatchRecord = z.infer<typeof attendanceBatchRecordSchema>;

export const attendanceBatchRequestSchema = z.object({
  sessionVersion: z.number().int(),
  records: z.array(attendanceBatchRecordSchema).min(1),
});
export type AttendanceBatchRequest = z.infer<typeof attendanceBatchRequestSchema>;

export const batchSummarySchema = z.object({
  present: z.number().int(),
  absent: z.number().int(),
  late: z.number().int(),
  missing: z.number().int(),
});
export type BatchSummary = z.infer<typeof batchSummarySchema>;

export const attendanceBatchResponseSchema = z.object({
  sessionVersion: z.number().int(),
  updated: z.number().int(),
  summary: batchSummarySchema,
});
export type AttendanceBatchResponse = z.infer<typeof attendanceBatchResponseSchema>;

export const markAllPresentRequestSchema = z.object({ sessionVersion: z.number().int() });
export type MarkAllPresentRequest = z.infer<typeof markAllPresentRequestSchema>;

// ---------------------------------------------------------------------------
// Homework batch
// ---------------------------------------------------------------------------

export const homeworkBatchRecordSchema = z.object({
  enrollmentId: z.string().uuid(),
  status: homeworkStatusSchema,
});
export type HomeworkBatchRecord = z.infer<typeof homeworkBatchRecordSchema>;

export const homeworkBatchRequestSchema = z.object({
  sessionVersion: z.number().int(),
  records: z.array(homeworkBatchRecordSchema).min(1),
});
export type HomeworkBatchRequest = z.infer<typeof homeworkBatchRequestSchema>;

export const homeworkBatchSummarySchema = z.object({
  done: z.number().int(),
  partial: z.number().int(),
  notDone: z.number().int(),
  noHomework: z.number().int(),
  missing: z.number().int(),
});
export type HomeworkBatchSummary = z.infer<typeof homeworkBatchSummarySchema>;

export const homeworkBatchResponseSchema = z.object({
  sessionVersion: z.number().int(),
  updated: z.number().int(),
  summary: homeworkBatchSummarySchema,
});
export type HomeworkBatchResponse = z.infer<typeof homeworkBatchResponseSchema>;

export const markAllDoneRequestSchema = z.object({ sessionVersion: z.number().int() });
export type MarkAllDoneRequest = z.infer<typeof markAllDoneRequestSchema>;

export const noHomeworkRequestSchema = z.object({ sessionVersion: z.number().int() });
export type NoHomeworkRequest = z.infer<typeof noHomeworkRequestSchema>;

// ---------------------------------------------------------------------------
// Exam
// ---------------------------------------------------------------------------

export const examDefinitionRequestSchema = z.object({
  hasExam: z.boolean(),
  name: z.string().trim().min(1).optional(),
  maxScore: z.number().positive().optional(),
  lowScoreThreshold: z.number().min(0).optional(),
  /** Required when updating an already-defined exam (optimistic concurrency); omitted on first definition. */
  version: z.number().int().optional(),
});
export type ExamDefinitionRequest = z.infer<typeof examDefinitionRequestSchema>;

export const examDefinitionResponseSchema = z.object({
  hasExam: z.boolean(),
  name: z.string().nullable(),
  maxScore: z.number().nullable(),
  lowScoreThreshold: z.number().nullable(),
  version: z.number().int().nullable(),
});
export type ExamDefinitionResponse = z.infer<typeof examDefinitionResponseSchema>;

export const examScoreBatchRecordSchema = z.union([
  z.object({ enrollmentId: z.string().uuid(), status: z.literal("SCORED"), score: z.number().min(0) }),
  z.object({ enrollmentId: z.string().uuid(), status: z.literal("ABSENT_FROM_EXAM") }),
]);
export type ExamScoreBatchRecord = z.infer<typeof examScoreBatchRecordSchema>;

export const examScoresBatchRequestSchema = z.object({
  sessionVersion: z.number().int(),
  records: z.array(examScoreBatchRecordSchema).min(1),
});
export type ExamScoresBatchRequest = z.infer<typeof examScoresBatchRequestSchema>;

export const examScoresBatchResponseSchema = z.object({
  sessionVersion: z.number().int(),
  updated: z.number().int(),
});
export type ExamScoresBatchResponse = z.infer<typeof examScoresBatchResponseSchema>;

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

export const missingRecordItemSchema = z.object({
  enrollmentId: z.string().uuid(),
  studentName: z.string(),
  missing: z.array(z.enum(["ATTENDANCE", "HOMEWORK"])),
});
export type MissingRecordItem = z.infer<typeof missingRecordItemSchema>;

export const sessionReviewResponseSchema = z.object({
  attendanceSummary: batchSummarySchema,
  homeworkSummary: homeworkBatchSummarySchema,
  examSummary: z.object({
    hasExam: z.boolean(),
    scored: z.number().int(),
    absent: z.number().int(),
    missing: z.number().int(),
  }),
  /**
   * Server-derived, not a stored table (PRD §7.4 — "لا يوجد جدول Canonical
   * اسمه MissingRecord يكون Source of Truth"). Rebuildable from
   * session_records + roster on every call.
   */
  missingRecords: z.array(missingRecordItemSchema),
  canComplete: z.boolean(),
  blockingReasons: z.array(z.string()),
});
export type SessionReviewResponse = z.infer<typeof sessionReviewResponseSchema>;

// ---------------------------------------------------------------------------
// Complete
// ---------------------------------------------------------------------------

export const sessionCompleteRequestSchema = z.object({ version: z.number().int() });
export type SessionCompleteRequest = z.infer<typeof sessionCompleteRequestSchema>;

export const sessionCompleteResponseSchema = z.object({ session: sessionSchema });
export type SessionCompleteResponse = z.infer<typeof sessionCompleteResponseSchema>;
