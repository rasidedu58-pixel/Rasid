import { z } from "zod";

/**
 * Onboarding — guided-setup status contract.
 *
 * Read-only aggregator (`GET /onboarding/status`) that derives the
 * teacher's setup progress entirely from real workspace domain state.
 *
 * BACKEND vs UX SEPARATION (owner decision):
 * The server exposes FIVE raw business states, but the UI only
 * presents FOUR guided-setup steps. `sessionsGenerated` is a
 * system-derived readiness signal — not something the user is asked
 * to do; auto-generation happens inside the same transaction as
 * `operatingMonthPrepared`. The client shows a confidence line
 * ("تم تجهيز حصص هذا الشهر تلقائيًا") when the raw signal is on, but
 * does NOT elevate it to a task in the checklist.
 *
 * ## Raw states (from `packages/database/src/onboarding/setup-status.repository.ts`)
 *
 *   groupExists              — ≥1 `groups.status='ACTIVE'` on the workspace.
 *                              Independent of any operating month — a
 *                              permanent group can exist without a month.
 *
 *   operatingMonthPrepared   — the workspace has an `operating_months`
 *                              row with `status='CURRENT'`, AND at least
 *                              one `group_months` bound to it, AND at
 *                              least one `schedule_rules` for that
 *                              group_month. DRAFT does NOT count.
 *
 *   studentsEnrolled         — ≥1 `enrollments.status='ACTIVE'` bound to
 *                              a `group_months` of the CURRENT month.
 *                              Bare workspace-only students never count;
 *                              PENDING / STOPPED / WITHDRAWN / TRANSFERRED
 *                              never count.
 *
 *   sessionsGenerated        — ≥1 `sessions.origin='GENERATED'` bound to
 *                              a `group_months` of the CURRENT month.
 *                              System-derived only; not a user task.
 *
 *   attendanceRecorded       — ≥1 `session_records.attendance_status IN
 *                              ('PRESENT','ABSENT','LATE')`. DELIBERATELY
 *                              workspace-global so a workspace that has
 *                              recorded real attendance never regresses
 *                              across CURRENT-month rollovers.
 *
 * ## UX steps (four visible checklist items)
 *
 *   createGroup       ← groupExists
 *   prepareMonth      ← operatingMonthPrepared
 *   enrollStudents    ← studentsEnrolled
 *   recordAttendance  ← attendanceRecorded
 *
 * Rationale for the ordering:
 *   • The first server-visible action a fresh Owner can perform is
 *     `POST /groups` — the /months/new page hard-blocks on
 *     `activeGroups.length === 0` and its underlying service refuses
 *     a preview without either `sourceMonthId` or a non-empty
 *     `selectedGroupIds`, so a workspace with zero groups can never
 *     reach the month page usefully. The wizard at /groups is the
 *     genuine first-run entry: it creates the durable Group, then
 *     tries to prepare it for the CURRENT month, and on
 *     NO_CURRENT_MONTH redirects to /months/new WITH a selectable
 *     group already in scope.
 *   • Step 2 wraps everything that the month flow writes atomically:
 *     the CURRENT month row, the group_month, its schedule, AND the
 *     auto-generated sessions. That is why the checklist has no
 *     separate "sessions" task.
 *   • Step 3 (enrollment) can only be completed once a group_month
 *     exists on the CURRENT month.
 *   • Step 4 (attendance) is intentionally workspace-global.
 */

export const onboardingStepKeySchema = z.enum([
  "createGroup",
  "prepareMonth",
  "enrollStudents",
  "recordAttendance",
]);
export type OnboardingStepKey = z.infer<typeof onboardingStepKeySchema>;

/**
 * Per-step status. Dependency-aware:
 *   COMPLETED — the underlying business state satisfies the predicate.
 *   AVAILABLE — every prior step is COMPLETED, and this one is not yet.
 *   LOCKED    — at least one prior step is not COMPLETED.
 * No IN_PROGRESS state: every predicate is a durable existence check
 * and (post-Discovery) session generation is inside the same
 * transaction as its trigger, so there is no transient phase.
 */
export const onboardingStepStatusSchema = z.enum(["COMPLETED", "AVAILABLE", "LOCKED"]);
export type OnboardingStepStatus = z.infer<typeof onboardingStepStatusSchema>;

/**
 * Raw business signals — exposed so the client can render confidence
 * copy (e.g. "تم تجهيز حصص هذا الشهر تلقائيًا") without needing a
 * separate task in the checklist. All five are pure existence checks
 * on already-indexed columns.
 */
export const onboardingRawStatesSchema = z.object({
  groupExists: z.boolean(),
  operatingMonthPrepared: z.boolean(),
  studentsEnrolled: z.boolean(),
  sessionsGenerated: z.boolean(),
  attendanceRecorded: z.boolean(),
});
export type OnboardingRawStates = z.infer<typeof onboardingRawStatesSchema>;

export const onboardingStatusResponseSchema = z.object({
  /** How many of the FOUR visible steps are COMPLETED. */
  completed: z.number().int().min(0).max(4),
  total: z.literal(4),
  steps: z.object({
    createGroup: onboardingStepStatusSchema,
    prepareMonth: onboardingStepStatusSchema,
    enrollStudents: onboardingStepStatusSchema,
    recordAttendance: onboardingStepStatusSchema,
  }),
  /** Convenience — first non-completed step in dependency order, or null when done. */
  nextStep: onboardingStepKeySchema.nullable(),
  /** True when every UX step is COMPLETED. Redundant with `completed === 4` but explicit. */
  allDone: z.boolean(),
  /** Raw signals — see file docstring. */
  rawStates: onboardingRawStatesSchema,
});
export type OnboardingStatusResponse = z.infer<typeof onboardingStatusResponseSchema>;

/**
 * Deterministic step order — used server-side to derive `nextStep` and
 * `LOCKED`/`AVAILABLE` cascade, and reused by the client to render the
 * panel in the same order without duplicating the sequence.
 */
export const ONBOARDING_STEP_ORDER: readonly OnboardingStepKey[] = [
  "createGroup",
  "prepareMonth",
  "enrollStudents",
  "recordAttendance",
] as const;
