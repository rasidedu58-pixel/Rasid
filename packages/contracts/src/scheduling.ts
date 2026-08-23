import { z } from "zod";
import { cursorPageSchema } from "./pagination";

/**
 * Scheduling contract types (Months / Groups / GroupMonth / Schedule /
 * Sessions) — Phase 3, API Contract v1.0 §9.2/§9.3/§9.4, §11.3/§11.4.
 * Shared between apps/api (producer) and apps/web (consumer).
 */

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export const groupStatusSchema = z.enum(["ACTIVE", "ARCHIVED"]);
export type GroupStatus = z.infer<typeof groupStatusSchema>;

export const groupSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  subject: z.string().nullable(),
  grade: z.string().nullable(),
  defaultLocationId: z.string().uuid().nullable(),
  status: groupStatusSchema,
  version: z.number().int(),
});
export type Group = z.infer<typeof groupSchema>;

export const createGroupRequestSchema = z.object({
  name: z.string().trim().min(1),
  subject: z.string().trim().min(1).optional(),
  grade: z.string().trim().min(1).optional(),
  defaultLocationId: z.string().uuid().optional(),
});
export type CreateGroupRequest = z.infer<typeof createGroupRequestSchema>;

export const updateGroupRequestSchema = z.object({
  version: z.number().int(),
  name: z.string().trim().min(1).optional(),
  subject: z.string().trim().min(1).nullable().optional(),
  grade: z.string().trim().min(1).nullable().optional(),
  defaultLocationId: z.string().uuid().nullable().optional(),
  status: groupStatusSchema.optional(),
});
export type UpdateGroupRequest = z.infer<typeof updateGroupRequestSchema>;

export const listGroupsResponseSchema = z.object({ groups: z.array(groupSchema) });
export type ListGroupsResponse = z.infer<typeof listGroupsResponseSchema>;

// ---------------------------------------------------------------------------
// Months
// ---------------------------------------------------------------------------

export const operatingMonthStatusSchema = z.enum(["DRAFT", "CURRENT", "ARCHIVED"]);
export type OperatingMonthStatus = z.infer<typeof operatingMonthStatusSchema>;

export const operatingMonthSchema = z.object({
  id: z.string().uuid(),
  year: z.number().int(),
  month: z.number().int(),
  status: operatingMonthStatusSchema,
  version: z.number().int(),
});
export type OperatingMonth = z.infer<typeof operatingMonthSchema>;

export const listMonthsResponseSchema = z.object({ months: z.array(operatingMonthSchema) });
export type ListMonthsResponse = z.infer<typeof listMonthsResponseSchema>;

const scheduleRuleInputSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{1,2}:\d{2}(:\d{2})?$/),
  durationMinutes: z.number().int().positive(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type ScheduleRuleInputDto = z.infer<typeof scheduleRuleInputSchema>;

/**
 * `groupInitialConfig` supplies the per-group commercial + schedule facts
 * needed to create the FIRST-EVER GroupMonth for a group with no
 * `sourceMonthId` to carry forward from — see the Phase 3 handoff notes on
 * why `schedule/apply` doubles as the initial-schedule-creation mechanism
 * for carried-forward groups, while brand-new groups supply their initial
 * facts directly here at month-creation time (no separate endpoint exists
 * in the approved registry for this).
 */
export const createMonthPreviewRequestSchema = z.object({
  targetYear: z.number().int().min(2020).max(2100),
  targetMonth: z.number().int().min(1).max(12),
  sourceMonthId: z.string().uuid().optional(),
  selectedGroupIds: z.array(z.string().uuid()).optional(),
  groupInitialConfig: z
    .record(
      z.object({
        locationId: z.string().uuid().nullable().optional(),
        baseFeeMinor: z.number().int().min(0),
        currencyCode: z.string().length(3).default("EGP"),
        duePolicy: z.enum(["UNIFIED", "PER_GROUP", "OVERRIDE"]),
        dueDay: z.number().int().min(1).max(28).nullable().optional(),
        joinFeePolicy: z.enum(["ASK_EVERY_TIME", "FULL", "REMAINING"]),
        scheduleRules: z.array(scheduleRuleInputSchema),
      }),
    )
    .optional(),
});
export type CreateMonthPreviewRequest = z.infer<typeof createMonthPreviewRequestSchema>;

/**
 * `students`/`newObligationsTotalMinor`/`studentsWithOldDebt` were
 * deliberately OMITTED (not fabricated as zeros) until Students/Enrollments/
 * Finance existed (Phase 3 pre-authorized scoping decision #3) — now closed
 * by the Phase 6 Closure Delta (CreateMonth Carry-Forward Integration).
 * `continuing`/`excluded`/`transferred` classify the SOURCE month's
 * enrollments for a `sourceMonthId` preview (continuing = ACTIVE only);
 * for a `selectedGroupIds` preview (no source month to carry from) these
 * are genuinely zero, not fabricated. `studentsWithOldDebt` counts
 * continuing students with any prior obligation still owing — informational
 * only, never affects eligibility or allocation.
 */
export const createMonthPreviewResponseSchema = z.object({
  previewToken: z.string(),
  groups: z.array(z.object({ groupId: z.string().uuid(), name: z.string() })),
  generatedSessions: z.number().int(),
  students: z.object({
    continuing: z.number().int(),
    excluded: z.number().int(),
    transferred: z.number().int(),
  }),
  newObligationsTotalMinor: z.number().int(),
  studentsWithOldDebt: z.number().int(),
  expiresAt: z.string(),
});
export type CreateMonthPreviewResponse = z.infer<typeof createMonthPreviewResponseSchema>;

export const createMonthConfirmRequestSchema = z.object({ previewToken: z.string() });
export type CreateMonthConfirmRequest = z.infer<typeof createMonthConfirmRequestSchema>;

export const createMonthConfirmResponseSchema = z.object({
  monthId: z.string().uuid(),
  status: z.literal("CURRENT"),
  groupMonthCount: z.number().int(),
  sessionCount: z.number().int(),
  enrollmentCount: z.number().int(),
});
export type CreateMonthConfirmResponse = z.infer<typeof createMonthConfirmResponseSchema>;

// ---------------------------------------------------------------------------
// GroupMonth
// ---------------------------------------------------------------------------

export const groupMonthSchema = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid(),
  operatingMonthId: z.string().uuid(),
  locationId: z.string().uuid().nullable(),
  baseFeeMinor: z.number().int(),
  currencyCode: z.string(),
  duePolicy: z.enum(["UNIFIED", "PER_GROUP", "OVERRIDE"]),
  dueDay: z.number().int().nullable(),
  joinFeePolicy: z.enum(["ASK_EVERY_TIME", "FULL", "REMAINING"]),
  monthlyStatus: z.enum(["ACTIVE", "ARCHIVED"]),
  version: z.number().int(),
});
export type GroupMonth = z.infer<typeof groupMonthSchema>;

export const groupMonthChangePreviewRequestSchema = z.object({
  locationId: z.string().uuid().nullable().optional(),
  baseFeeMinor: z.number().int().min(0).optional(),
  duePolicy: z.enum(["UNIFIED", "PER_GROUP", "OVERRIDE"]).optional(),
  dueDay: z.number().int().min(1).max(28).nullable().optional(),
  joinFeePolicy: z.enum(["ASK_EVERY_TIME", "FULL", "REMAINING"]).optional(),
});
export type GroupMonthChangePreviewRequest = z.infer<typeof groupMonthChangePreviewRequestSchema>;

export const groupMonthFieldDiffSchema = z.object({
  field: z.string(),
  before: z.unknown(),
  after: z.unknown(),
});

export const groupMonthChangePreviewResponseSchema = z.object({
  previewToken: z.string(),
  currentVersion: z.number().int(),
  diff: z.array(groupMonthFieldDiffSchema),
  expiresAt: z.string(),
});
export type GroupMonthChangePreviewResponse = z.infer<typeof groupMonthChangePreviewResponseSchema>;

export const groupMonthApplyChangeRequestSchema = z.object({
  previewToken: z.string(),
  expectedVersion: z.number().int(),
});
export type GroupMonthApplyChangeRequest = z.infer<typeof groupMonthApplyChangeRequestSchema>;

export const groupMonthApplyChangeResponseSchema = z.object({
  groupMonth: groupMonthSchema,
});
export type GroupMonthApplyChangeResponse = z.infer<typeof groupMonthApplyChangeResponseSchema>;

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

export const scheduleRuleSchema = z.object({
  id: z.string().uuid(),
  weekday: z.number().int(),
  startTime: z.string(),
  durationMinutes: z.number().int(),
  effectiveFrom: z.string().nullable(),
  effectiveTo: z.string().nullable(),
});
export type ScheduleRule = z.infer<typeof scheduleRuleSchema>;

export const listScheduleRulesResponseSchema = z.object({ rules: z.array(scheduleRuleSchema) });
export type ListScheduleRulesResponse = z.infer<typeof listScheduleRulesResponseSchema>;

export const schedulePreviewRequestSchema = z.object({ rules: z.array(scheduleRuleInputSchema) });
export type SchedulePreviewRequest = z.infer<typeof schedulePreviewRequestSchema>;

export const sessionDiffEntrySchema = z.object({
  scheduledAt: z.string(),
  durationMinutes: z.number().int(),
});

export const schedulePreviewResponseSchema = z.object({
  previewToken: z.string(),
  toAdd: z.array(sessionDiffEntrySchema),
  toRemove: z.array(z.object({ sessionId: z.string().uuid(), scheduledAt: z.string() })),
  unchanged: z.array(z.object({ sessionId: z.string().uuid(), scheduledAt: z.string() })),
  expiresAt: z.string(),
});
export type SchedulePreviewResponse = z.infer<typeof schedulePreviewResponseSchema>;

export const scheduleApplyRequestSchema = z.object({ previewToken: z.string() });
export type ScheduleApplyRequest = z.infer<typeof scheduleApplyRequestSchema>;

export const scheduleApplyResponseSchema = z.object({
  rules: z.array(scheduleRuleSchema),
  cancelledSessionIds: z.array(z.string().uuid()),
  createdSessionIds: z.array(z.string().uuid()),
});
export type ScheduleApplyResponse = z.infer<typeof scheduleApplyResponseSchema>;

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export const sessionStatusSchema = z.enum([
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "RESCHEDULED",
]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const sessionOriginSchema = z.enum(["GENERATED", "MANUAL", "RESCHEDULE_REPLACEMENT"]);
export type SessionOrigin = z.infer<typeof sessionOriginSchema>;

export const sessionSchema = z.object({
  id: z.string().uuid(),
  groupMonthId: z.string().uuid(),
  scheduledAt: z.string(),
  durationMinutes: z.number().int(),
  status: sessionStatusSchema,
  origin: sessionOriginSchema,
  rescheduledFromSessionId: z.string().uuid().nullable(),
  billableForProration: z.boolean(),
  version: z.number().int(),
});
export type Session = z.infer<typeof sessionSchema>;

export const listSessionsResponseSchema = cursorPageSchema(sessionSchema);
export type ListSessionsResponse = z.infer<typeof listSessionsResponseSchema>;

export const sessionCancelResponseSchema = z.object({ session: sessionSchema });
export type SessionCancelResponse = z.infer<typeof sessionCancelResponseSchema>;

export const sessionReschedulePreviewRequestSchema = z.object({
  scheduledAt: z.string(),
  durationMinutes: z.number().int().positive(),
});
export type SessionReschedulePreviewRequest = z.infer<typeof sessionReschedulePreviewRequestSchema>;

export const sessionReschedulePreviewResponseSchema = z.object({
  previewToken: z.string(),
  proposed: z.object({ scheduledAt: z.string(), durationMinutes: z.number().int() }),
  expiresAt: z.string(),
});
export type SessionReschedulePreviewResponse = z.infer<typeof sessionReschedulePreviewResponseSchema>;

export const sessionRescheduleRequestSchema = z.object({ previewToken: z.string() });
export type SessionRescheduleRequest = z.infer<typeof sessionRescheduleRequestSchema>;

export const sessionRescheduleResponseSchema = z.object({
  original: sessionSchema,
  replacement: sessionSchema,
});
export type SessionRescheduleResponse = z.infer<typeof sessionRescheduleResponseSchema>;
