import { z } from "zod";

/**
 * Reports / Notifications / Action Center contract types — Phase 9, API
 * Contract v1.0 §9.10, §11.17, §17. No worked JSON schema exists in the
 * approved docs for `/reports/student/{id}`, `/reports/group/{id}`, or
 * `/reports/monthly/{monthId}` (only the endpoint registry rows) — these
 * shapes are this phase's own reasonable design, deriving every field
 * directly from PRD §38's own "core rows/metrics" bullet lists, never
 * inventing a metric the PRD doesn't name.
 */

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

const attendanceSummarySchema = z.object({ present: z.number().int(), absent: z.number().int(), late: z.number().int(), missing: z.number().int() });
const homeworkSummarySchema = z.object({ done: z.number().int(), partial: z.number().int(), notDone: z.number().int(), noHomework: z.number().int(), missing: z.number().int() });
const examSummarySchema = z.object({ scored: z.number().int(), absent: z.number().int(), missing: z.number().int() });
const monthRefSchema = z.object({ id: z.string().uuid(), year: z.number().int(), month: z.number().int() });

// ---------------------------------------------------------------------------
// Student Report — GET /reports/student/{id}
// ---------------------------------------------------------------------------

export const studentReportResponseSchema = z.object({
  student: z.object({ id: z.string().uuid(), name: z.string(), studentCode: z.string(), status: z.string() }),
  currentMonth: monthRefSchema.nullable(),
  sessions: z.object({ total: z.number().int(), attendance: attendanceSummarySchema, homework: homeworkSummarySchema, exam: examSummarySchema }),
  activeAttentionCase: z.object({ id: z.string().uuid(), status: z.string(), priority: z.string(), openedAt: z.string() }).nullable(),
  obligationsByMonth: z.array(
    z.object({
      monthId: z.string().uuid(),
      year: z.number().int(),
      month: z.number().int(),
      groupId: z.string().uuid(),
      groupName: z.string(),
      netDueMinor: z.number().int(),
      amountPaidMinor: z.number().int(),
      remainingMinor: z.number().int(),
      status: z.string(),
    }),
  ),
});
export type StudentReportResponse = z.infer<typeof studentReportResponseSchema>;

// ---------------------------------------------------------------------------
// Group Report — GET /reports/group/{id}
// ---------------------------------------------------------------------------

export const groupReportResponseSchema = z.object({
  group: z.object({ id: z.string().uuid(), name: z.string(), status: z.string() }),
  currentMonth: monthRefSchema.nullable(),
  roster: z.array(z.object({ enrollmentId: z.string().uuid(), studentId: z.string().uuid(), studentName: z.string(), status: z.string() })),
  sessions: z.object({ total: z.number().int(), completed: z.number().int() }),
  attendance: attendanceSummarySchema,
  homework: homeworkSummarySchema,
  missingRecordsCount: z.number().int(),
  // `null` when the caller lacks `finance.overview` — finance is redacted
  // server-side (never merely hidden in the UI).
  collection: z.object({ totalDueMinor: z.number().int(), totalPaidMinor: z.number().int(), totalRemainingMinor: z.number().int(), overdueCount: z.number().int() }).nullable(),
});
export type GroupReportResponse = z.infer<typeof groupReportResponseSchema>;

// ---------------------------------------------------------------------------
// Monthly Teacher Report — GET /reports/monthly/{monthId}
// ---------------------------------------------------------------------------

export const monthlyTeacherReportResponseSchema = z.object({
  month: z.object({ id: z.string().uuid(), year: z.number().int(), month: z.number().int(), status: z.string() }),
  groups: z.array(z.object({ groupId: z.string().uuid(), groupName: z.string(), studentsCount: z.number().int(), sessionsCount: z.number().int() })),
  totals: z.object({
    studentsCount: z.number().int(),
    sessionsCount: z.number().int(),
    // `collection`/`overdueCount` are `null` when the caller lacks
    // `finance.overview` — finance is redacted server-side, not UI-hidden.
    collection: z.object({ totalDueMinor: z.number().int(), totalPaidMinor: z.number().int(), totalRemainingMinor: z.number().int() }).nullable(),
    overdueCount: z.number().int().nullable(),
    openAttentionCount: z.number().int(),
    openFollowupsCount: z.number().int(),
  }),
});
export type MonthlyTeacherReportResponse = z.infer<typeof monthlyTeacherReportResponseSchema>;

// ---------------------------------------------------------------------------
// CSV Export — POST /reports/export, GET /exports/{id}, GET /exports/{id}/download
// ---------------------------------------------------------------------------

export const reportExportTypeSchema = z.enum(["STUDENT", "GROUP", "MONTHLY_TEACHER"]);
export type ReportExportType = z.infer<typeof reportExportTypeSchema>;

/** Export file formats. CSV stays for back-compat; XLSX/PDF are the premium renderers. */
export const reportExportFormatSchema = z.enum(["CSV", "XLSX", "PDF"]);
export type ReportExportFormat = z.infer<typeof reportExportFormatSchema>;

export const createReportExportRequestSchema = z.object({
  type: reportExportTypeSchema,
  format: reportExportFormatSchema.default("CSV"),
  studentId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
  monthId: z.string().uuid().optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
});
export type CreateReportExportRequest = z.infer<typeof createReportExportRequestSchema>;

export const createReportExportResponseSchema = z.object({
  exportId: z.string().uuid(),
  status: z.enum(["QUEUED", "READY", "FAILED"]),
});
export type CreateReportExportResponse = z.infer<typeof createReportExportResponseSchema>;

export const getExportResponseSchema = z.object({
  status: z.enum(["QUEUED", "READY", "FAILED"]),
  downloadUrl: z.string().nullable(),
  expiresAt: z.string(),
  errorMessage: z.string().nullable(),
});
export type GetExportResponse = z.infer<typeof getExportResponseSchema>;

// ---------------------------------------------------------------------------
// Notifications — GET /notifications, POST /notifications/{id}/read, POST /notifications/read-all
// ---------------------------------------------------------------------------

export const notificationTypeSchema = z.enum(["SUBSCRIPTION_EXPIRING", "FOLLOWUP_DUE", "MISSING_RECORDS"]);
export type NotificationTypeDto = z.infer<typeof notificationTypeSchema>;

export const notificationSchema = z.object({
  id: z.string().uuid(),
  type: notificationTypeSchema,
  title: z.string(),
  body: z.string(),
  entityType: z.string().nullable(),
  entityId: z.string().uuid().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type NotificationDto = z.infer<typeof notificationSchema>;

export const listNotificationsResponseSchema = z.object({
  notifications: z.array(notificationSchema),
  unreadCount: z.number().int(),
});
export type ListNotificationsResponse = z.infer<typeof listNotificationsResponseSchema>;

export const markNotificationReadResponseSchema = z.object({ id: z.string().uuid(), readAt: z.string() });
export type MarkNotificationReadResponse = z.infer<typeof markNotificationReadResponseSchema>;

export const markAllNotificationsReadResponseSchema = z.object({ markedCount: z.number().int() });
export type MarkAllNotificationsReadResponse = z.infer<typeof markAllNotificationsReadResponseSchema>;

// ---------------------------------------------------------------------------
// Action Center — GET /action-center (API Contract §17's exact shape)
//
// Phase 9 Closure correction #5: every section is independently
// authorization-aware. A caller lacking access to a section simply gets
// that section OMITTED (not present in the response at all) rather than a
// 403 for the whole endpoint or a visible-but-zeroed count (a zero count
// would still let a caller infer "no items", which is itself information
// they aren't entitled to — omission is the only safe-no-leak shape).
// ---------------------------------------------------------------------------

const actionItemSchema = z.object({
  entityType: z.string(),
  entityId: z.string().uuid(),
  reason: z.string(),
  urgency: z.enum(["LOW", "MEDIUM", "HIGH"]),
  nextAction: z.string(),
});

export const actionCenterResponseSchema = z.object({
  month: monthRefSchema.nullable(),
  nextSession: z.object({ id: z.string().uuid(), groupName: z.string(), scheduledAt: z.string(), status: z.enum(["SCHEDULED", "IN_PROGRESS"]) }).nullable().optional(),
  missingRecords: z.object({ count: z.number().int(), items: z.array(actionItemSchema) }).optional(),
  followUpsDue: z.object({ count: z.number().int(), items: z.array(actionItemSchema) }).optional(),
  attention: z.object({ count: z.number().int(), items: z.array(actionItemSchema) }).optional(),
  collection: z.object({ count: z.number().int(), items: z.array(actionItemSchema) }).optional(),
  subscriptionWarning: z.object({ state: z.string(), daysRemaining: z.number().int().nullable(), message: z.string() }).nullable().optional(),
  asOf: z.string(),
});
export type ActionCenterResponse = z.infer<typeof actionCenterResponseSchema>;
