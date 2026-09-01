/**
 * Capacity enforcement — Billing Engine, Phase 2.
 *
 * Answers two questions, race-safely, at the repository-transaction level (so
 * no controller path can bypass them):
 *   • how many UNIQUE active students does a workspace have this operational
 *     month, vs its plan limit?
 *   • how many ACTIVE non-owner team members, vs its plan limit?
 *
 * DESIGN NOTES
 *  - "Active student" = a DISTINCT student with an ACTIVE enrollment in a
 *    group-month of the workspace's CURRENT operating month. A student in N
 *    groups counts ONCE (COUNT(DISTINCT student_id)).
 *  - The plan LIMIT is resolved through the single-source `resolvePlanLimits`
 *    (packages/contracts), called by the FIXED module-private `resolveLimitsFor`
 *    — never a caller-supplied resolver, so no production mutation path can pass
 *    a permissive limit and bypass the plan. One catalog, no duplication.
 *  - RACE SAFETY: every ACTIVE-creating transaction first takes a row lock on
 *    the workspace's `subscriptions` row (`SELECT ... FOR UPDATE`) — the same
 *    established primitive `recordPaymentTransaction` uses. That serialises all
 *    capacity-affecting mutations for one workspace, so two concurrent "add a
 *    new student at 499/500" transactions cannot both pass and reach 501.
 *  - SEPARATION: this is "how MUCH can you run", layered AFTER the entitlement
 *    guard's "are you allowed to run at all" (an EXPIRED workspace is already
 *    blocked upstream). Capacity NEVER deletes/deactivates data or stops
 *    existing operations — only NEW capacity is refused.
 */
import { and, count, countDistinct, eq, ne } from "drizzle-orm";
import { resolvePlanLimits, PlanLimitsResolutionError, type PlanCode, type SubscriptionStateDto } from "@academic-precision/contracts";
import type { Db } from "../repositories/identity.repository";
import { subscriptions } from "../schema/subscriptions";
import { enrollments } from "../schema/enrollments";
import { groupMonths } from "../schema/groups";
import { operatingMonths } from "../schema/months";
import { memberships } from "../schema/permissions";

const CURRENT_MONTH_STATUS = "CURRENT";
const ACTIVE_ENROLLMENT_STATUS = "ACTIVE";
const ACTIVE_MEMBERSHIP_STATUS = "ACTIVE";
const OWNER_ROLE_LABEL = "OWNER";

// ---------------------------------------------------------------------------
// Typed domain errors (thrown from inside repository transactions). They carry
// a duck-typed marker + http status + code so the API's global exception filter
// maps them to the response contract WITHOUT importing this package's classes.
// ---------------------------------------------------------------------------

export abstract class BillingCapacityError extends Error {
  /** Marker the API filter checks (no cross-package import needed). */
  readonly isBillingCapacityError = true as const;
  abstract readonly code: string;
  abstract readonly httpStatus: number;
  readonly details?: Record<string, unknown>;
}

export class CurrentOperationalMonthRequiredError extends BillingCapacityError {
  readonly code = "CURRENT_OPERATIONAL_MONTH_REQUIRED";
  readonly httpStatus = 409;
  constructor() {
    super("لا يوجد شهر تشغيلي حالي. جهّز الشهر التشغيلي الحالي قبل إضافة الطلاب.");
    this.name = "CurrentOperationalMonthRequiredError";
  }
}

export class PlanStudentLimitReachedError extends BillingCapacityError {
  readonly code = "PLAN_STUDENT_LIMIT_REACHED";
  readonly httpStatus = 409;
  override readonly details: { currentUsage: number; limit: number; planCode: string | null; upgradeRequired: true };
  constructor(currentUsage: number, limit: number, planCode: string | null) {
    super("وصلت إلى الحد الأقصى لعدد الطلاب في باقتك. قم بالترقية لإضافة المزيد من الطلاب.");
    this.name = "PlanStudentLimitReachedError";
    this.details = { currentUsage, limit, planCode, upgradeRequired: true };
  }
}

export class PlanTeamLimitReachedError extends BillingCapacityError {
  readonly code = "PLAN_TEAM_LIMIT_REACHED";
  readonly httpStatus = 409;
  override readonly details: { currentUsage: number; limit: number; planCode: string | null; upgradeRequired: true };
  constructor(currentUsage: number, limit: number, planCode: string | null) {
    super("وصلت إلى الحد الأقصى لعدد أعضاء الفريق في باقتك. قم بالترقية لإضافة المزيد من الأعضاء.");
    this.name = "PlanTeamLimitReachedError";
    this.details = { currentUsage, limit, planCode, upgradeRequired: true };
  }
}

/**
 * A subscription whose plan cannot be mapped to limits — a non-TRIAL row with no
 * plan_code (legacy/unmapped) or a CUSTOM row missing its stored limits. Business-
 * safe remap of the contracts `PlanLimitsResolutionError` so capacity enforcement
 * NEVER surfaces a raw 500, and the internal `reason` is never leaked to the client.
 */
export class SubscriptionPlanUnmappedError extends BillingCapacityError {
  readonly code = "SUBSCRIPTION_PLAN_UNMAPPED";
  readonly httpStatus = 409;
  constructor() {
    super("تعذّر تحديد باقة اشتراك مساحة العمل. يرجى التواصل مع الدعم.");
    this.name = "SubscriptionPlanUnmappedError";
  }
}

// ---------------------------------------------------------------------------
// Trusted, FIXED limit resolution (single-source catalog in packages/contracts).
// ---------------------------------------------------------------------------

export interface SubscriptionPlanFields {
  state: string;
  planCode: string | null;
  customMaxActiveStudents: number | null;
  customMaxTeamMembers: number | null;
}

/**
 * The ONE bridge from a locked subscription row to its effective limits, via the
 * single-source `resolvePlanLimits` (packages/contracts). It is module-private
 * and NON-injectable on purpose: production mutation paths call the asserts with
 * NO resolver argument, so no internal caller can substitute a permissive
 * resolver to bypass the plan. May throw `PlanLimitsResolutionError` for an
 * unmapped/legacy subscription (mapped at the API boundary, never a silent grant).
 *
 * Exported ONLY for unit testing the remap — it is never passed into the asserts
 * (they hardcode it), so exporting it creates no caller-bypass seam.
 */
export function resolveLimitsFor(sub: SubscriptionPlanFields): { maxActiveStudents: number; maxTeamMembers: number } {
  try {
    return resolvePlanLimits({
      subscriptionState: sub.state as SubscriptionStateDto,
      planCode: sub.planCode as PlanCode | null,
      customMaxActiveStudents: sub.customMaxActiveStudents,
      customMaxTeamMembers: sub.customMaxTeamMembers,
    });
  } catch (err) {
    // UNMAPPED_LEGACY_SUBSCRIPTION / CUSTOM_LIMITS_MISSING → a business-safe 409,
    // never a raw 500, never leaking the internal reason.
    if (err instanceof PlanLimitsResolutionError) throw new SubscriptionPlanUnmappedError();
    throw err;
  }
}

/** Locks the workspace's subscription row (serialises capacity mutations) and returns its plan fields. */
async function lockWorkspaceSubscription(tx: Db, workspaceId: string): Promise<SubscriptionPlanFields> {
  const [row] = await tx
    .select({
      state: subscriptions.state,
      planCode: subscriptions.planCode,
      customMaxActiveStudents: subscriptions.customMaxActiveStudents,
      customMaxTeamMembers: subscriptions.customMaxTeamMembers,
    })
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, workspaceId))
    .for("update");
  if (!row) throw new Error(`No subscription row for workspace ${workspaceId} while checking capacity.`);
  return row;
}

// ---------------------------------------------------------------------------
// Read-only usage (for display / API — NOT the enforcement path).
// ---------------------------------------------------------------------------

export async function findCurrentMonthId(db: Db, workspaceId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ id: operatingMonths.id })
    .from(operatingMonths)
    .where(and(eq(operatingMonths.workspaceId, workspaceId), eq(operatingMonths.status, CURRENT_MONTH_STATUS)))
    .limit(1);
  return row?.id;
}

/** DISTINCT active students in a given operating month (a student in many groups counts once). */
export async function getActiveStudentCountForMonth(db: Db, workspaceId: string, operatingMonthId: string): Promise<number> {
  const [row] = await db
    .select({ n: countDistinct(enrollments.studentId) })
    .from(enrollments)
    .innerJoin(groupMonths, eq(groupMonths.id, enrollments.groupMonthId))
    .where(
      and(
        eq(enrollments.workspaceId, workspaceId),
        eq(enrollments.status, ACTIVE_ENROLLMENT_STATUS),
        eq(groupMonths.operatingMonthId, operatingMonthId),
      ),
    );
  return Number(row?.n ?? 0);
}

export interface ActiveStudentUsage {
  currentMonthId: string;
  activeStudents: number;
}

/**
 * Usage for the workspace's CURRENT month. Throws
 * `CurrentOperationalMonthRequiredError` when none is CURRENT — NEVER returns a
 * phantom zero (a DRAFT-only workspace must not read as "0 used, add freely").
 */
export async function getActiveStudentUsage(db: Db, workspaceId: string): Promise<ActiveStudentUsage> {
  const currentMonthId = await findCurrentMonthId(db, workspaceId);
  if (!currentMonthId) throw new CurrentOperationalMonthRequiredError();
  const activeStudents = await getActiveStudentCountForMonth(db, workspaceId, currentMonthId);
  return { currentMonthId, activeStudents };
}

/** ACTIVE non-owner members (the Owner is never counted; PENDING invitations are not members). */
export async function getActiveTeamUsage(db: Db, workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(memberships)
    .where(
      and(
        eq(memberships.workspaceId, workspaceId),
        eq(memberships.status, ACTIVE_MEMBERSHIP_STATUS),
        ne(memberships.roleLabel, OWNER_ROLE_LABEL),
      ),
    );
  return Number(row?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Pure decision helpers — the actual rules, split out so they are unit-testable
// without a database (the DB-coupled asserts below just gather the inputs).
// ---------------------------------------------------------------------------

/**
 * Student rule: a NEW unique student is refused only at/over the limit. A student
 * already active this month adds no unique usage and is ALWAYS allowed (even at
 * the cap) — joining a second group must never be blocked.
 */
export function studentEnrollmentDecision(input: {
  limit: number;
  currentUsage: number;
  studentAlreadyActive: boolean;
}): "ALLOW" | "BLOCK" {
  if (input.studentAlreadyActive) return "ALLOW";
  return input.currentUsage >= input.limit ? "BLOCK" : "ALLOW";
}

/** Team rule: activating a new non-owner member is refused once active usage meets the limit. */
export function teamActivationDecision(input: { limit: number; currentUsage: number }): "ALLOW" | "BLOCK" {
  return input.currentUsage >= input.limit ? "BLOCK" : "ALLOW";
}

/** Carry-forward rule: the distinct students copied into the new (empty) month cannot exceed the limit. */
export function carryForwardDecision(input: { limit: number; distinctStudentCount: number }): "ALLOW" | "BLOCK" {
  return input.distinctStudentCount > input.limit ? "BLOCK" : "ALLOW";
}

// ---------------------------------------------------------------------------
// Enforcement (call INSIDE the ACTIVE-creating transaction, before the write).
// ---------------------------------------------------------------------------

export interface StudentEnrollmentCapacityInput {
  workspaceId: string;
  studentId: string;
  /** The group-month the enrollment will land in — used to tell whether it affects the CURRENT month. */
  targetGroupMonthId: string;
}

/**
 * Refuse an enrollment ONLY when it would make a NEW unique student active in
 * the CURRENT month beyond the plan limit. If the student is already active in
 * the current month (e.g. joining a second group), it adds no unique usage and
 * is always allowed — even at 500/500.
 */
export async function assertStudentCapacityForEnrollment(tx: Db, input: StudentEnrollmentCapacityInput): Promise<void> {
  const sub = await lockWorkspaceSubscription(tx, input.workspaceId);
  const { maxActiveStudents } = resolveLimitsFor(sub); // may throw the single-source unmapped-plan error

  const currentMonthId = await findCurrentMonthId(tx, input.workspaceId);
  if (!currentMonthId) throw new CurrentOperationalMonthRequiredError();

  const [gm] = await tx
    .select({ operatingMonthId: groupMonths.operatingMonthId })
    .from(groupMonths)
    .where(and(eq(groupMonths.id, input.targetGroupMonthId), eq(groupMonths.workspaceId, input.workspaceId)))
    .limit(1);
  if (!gm) throw new Error(`Group month ${input.targetGroupMonthId} not found while checking capacity.`);

  // Enrollment into a non-current month does not change CURRENT usage.
  if (gm.operatingMonthId !== currentMonthId) return;

  // Already active in the current month (another group) → no new unique student.
  const already = await tx
    .select({ id: enrollments.id })
    .from(enrollments)
    .innerJoin(groupMonths, eq(groupMonths.id, enrollments.groupMonthId))
    .where(
      and(
        eq(enrollments.workspaceId, input.workspaceId),
        eq(enrollments.studentId, input.studentId),
        eq(enrollments.status, ACTIVE_ENROLLMENT_STATUS),
        eq(groupMonths.operatingMonthId, currentMonthId),
      ),
    )
    .limit(1);
  // Already active this month → studentEnrollmentDecision short-circuits to ALLOW;
  // return before the count to save the aggregate query.
  if (already.length > 0) return;

  const usage = await getActiveStudentCountForMonth(tx, input.workspaceId, currentMonthId);
  if (studentEnrollmentDecision({ limit: maxActiveStudents, currentUsage: usage, studentAlreadyActive: false }) === "BLOCK") {
    throw new PlanStudentLimitReachedError(usage, maxActiveStudents, sub.planCode);
  }
}

export interface CarryForwardCapacityInput {
  workspaceId: string;
  /** DISTINCT students that will be carried into the new month as ACTIVE. */
  distinctStudentCount: number;
}

/**
 * Bulk guard for month create / carry-forward: the new month starts empty, so
 * carrying `distinctStudentCount` students makes exactly that many active. Refuse
 * the whole (atomic) month-create if it would exceed the plan limit. Under the
 * same plan this is always within limit (it copies ≤ last month's active); it
 * only bites after a downgrade (Phase 4).
 */
export async function assertCarryForwardStudentCapacity(tx: Db, input: CarryForwardCapacityInput): Promise<void> {
  const sub = await lockWorkspaceSubscription(tx, input.workspaceId);
  const { maxActiveStudents } = resolveLimitsFor(sub);
  if (carryForwardDecision({ limit: maxActiveStudents, distinctStudentCount: input.distinctStudentCount }) === "BLOCK") {
    throw new PlanStudentLimitReachedError(input.distinctStudentCount, maxActiveStudents, sub.planCode);
  }
}

export interface TeamCapacityInput {
  workspaceId: string;
}

/** Refuse activating a new non-owner member when active team usage already meets the plan limit. */
export async function assertTeamCapacityForActivation(tx: Db, input: TeamCapacityInput): Promise<void> {
  const sub = await lockWorkspaceSubscription(tx, input.workspaceId);
  const { maxTeamMembers } = resolveLimitsFor(sub);
  const usage = await getActiveTeamUsage(tx, input.workspaceId);
  if (teamActivationDecision({ limit: maxTeamMembers, currentUsage: usage }) === "BLOCK") {
    throw new PlanTeamLimitReachedError(usage, maxTeamMembers, sub.planCode);
  }
}
