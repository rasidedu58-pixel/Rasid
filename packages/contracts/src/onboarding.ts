import { z } from "zod";

/**
 * Onboarding — guided-setup status contract.
 *
 * A read-only aggregator (`GET /onboarding/status`) that derives the
 * teacher's setup progress entirely from real workspace domain state.
 * There is no shadow completion table; the endpoint runs five `EXISTS`
 * queries and reports the truth. The web tier renders a launcher /
 * panel from this shape, and completion is invalidated after every
 * mutation that could change the underlying data.
 *
 * Step definitions and their completion predicates (authoritative,
 * verified against Rasid's Drizzle schema in Phase 15+):
 *
 *   operatingMonth — the workspace has an `operating_months` row with
 *     `status = 'CURRENT'`. `DRAFT` months do NOT count: a
 *     prepared-ahead month is not yet the driver of session generation
 *     for today's usage, and the dashboard consumes only CURRENT.
 *
 *   groupSetup — at least one `groups` row (`status = 'ACTIVE'`) has a
 *     `group_months` row bound to the CURRENT operating month AND at
 *     least one `schedule_rules` row exists for that group_month.
 *
 *   students — at least one `enrollments` row (`status = 'ACTIVE'`) is
 *     bound to a `group_months` of the CURRENT operating month. A
 *     workspace-only student without an enrollment does not count;
 *     PENDING / STOPPED / WITHDRAWN / TRANSFERRED do not count.
 *
 *   sessions — at least one `sessions` row exists with
 *     `origin = 'GENERATED'` bound to a `group_months` of the CURRENT
 *     operating month. Any session status (SCHEDULED / IN_PROGRESS /
 *     COMPLETED / CANCELLED / RESCHEDULED) is accepted; the point is
 *     that the auto-generator has produced sessions for the current
 *     cycle.
 *
 *   attendance — at least one `session_records` row exists with
 *     `attendance_status IN ('PRESENT', 'ABSENT', 'LATE')`. This step
 *     is intentionally NOT scoped to the current month: once a
 *     workspace has recorded real attendance, it must never regress to
 *     "not started" just because the CURRENT month rolled over.
 *
 * The response also carries a derived `completed`/`total` count and a
 * `nextStep` pointer (the first non-COMPLETED step in dependency
 * order), so the client does not need to re-implement the ordering.
 */

export const onboardingStepKeySchema = z.enum([
  "operatingMonth",
  "groupSetup",
  "students",
  "sessions",
  "attendance",
]);
export type OnboardingStepKey = z.infer<typeof onboardingStepKeySchema>;

/**
 * Per-step status. Dependency-aware:
 *   COMPLETED — the underlying business state satisfies the predicate.
 *   AVAILABLE — every prior step is COMPLETED, and this one is not yet.
 *   LOCKED    — at least one prior step is not COMPLETED.
 * There is no IN_PROGRESS state: session generation is synchronous and
 * every other step is a durable existence check, so there is no
 * transient "processing" phase we can honestly surface here.
 */
export const onboardingStepStatusSchema = z.enum(["COMPLETED", "AVAILABLE", "LOCKED"]);
export type OnboardingStepStatus = z.infer<typeof onboardingStepStatusSchema>;

export const onboardingStatusResponseSchema = z.object({
  completed: z.number().int().min(0).max(5),
  total: z.literal(5),
  steps: z.object({
    operatingMonth: onboardingStepStatusSchema,
    groupSetup: onboardingStepStatusSchema,
    students: onboardingStepStatusSchema,
    sessions: onboardingStepStatusSchema,
    attendance: onboardingStepStatusSchema,
  }),
  /** Convenience — first non-completed step in dependency order, or null when done. */
  nextStep: onboardingStepKeySchema.nullable(),
  /** True when every step is COMPLETED. Redundant with `completed === 5` but explicit. */
  allDone: z.boolean(),
});
export type OnboardingStatusResponse = z.infer<typeof onboardingStatusResponseSchema>;

/**
 * Deterministic step order — used server-side to derive `nextStep` and
 * `LOCKED`/`AVAILABLE` cascade, and reused by the client to render the
 * panel in the same order without duplicating the sequence.
 */
export const ONBOARDING_STEP_ORDER: readonly OnboardingStepKey[] = [
  "operatingMonth",
  "groupSetup",
  "students",
  "sessions",
  "attendance",
] as const;
