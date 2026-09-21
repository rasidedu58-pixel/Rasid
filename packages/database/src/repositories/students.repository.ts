/**
 * Students / Guardians / QR / Enrollment repository — Phase 4.
 *
 * Typed query helpers + transactional operations, containing no HTTP/
 * framework concerns — mirrors `scheduling.repository.ts`'s convention
 * exactly. Business/authorization decisions (permission checks, preview-
 * token validation) live in apps/api's application service layer, NOT here.
 */
import { and, asc, desc, eq, gt, inArray, isNull, sql as rawSql } from "drizzle-orm";
import { students } from "../schema/students";
import { guardians, studentGuardians } from "../schema/guardians";
import { qrCredentials } from "../schema/qr-credentials";
import { enrollments } from "../schema/enrollments";
import { groupMonths, groups } from "../schema/groups";
import { operatingMonths } from "../schema/months";
import { sessions } from "../schema/sessions";
import { auditEvents } from "../schema/audit";
import type { Db } from "./identity.repository";
// `SessionRow` is already exported by scheduling.repository.ts (same
// underlying `sessions` table) — re-used here (not redeclared) to avoid a
// duplicate-export name collision at the package barrel.
import type { SessionRow } from "./scheduling.repository";
// Phase 6 — the Enrollment+Obligation transaction combines both writes in
// ONE db.transaction(); `upsertObligationForEnrollment` is a plain
// (non-transaction-opening) helper designed to run inside an ALREADY-open
// tx, exactly like session-mode.repository.ts's own cross-file reuse of
// scheduling.repository.ts's idempotency helpers.
import { upsertObligationForEnrollment, type FinancialObligationRow, type ObligationTerms } from "./finance.repository";
import { assertStudentCapacityForEnrollment } from "../billing/capacity";

export type StudentRow = typeof students.$inferSelect;
export type GuardianRow = typeof guardians.$inferSelect;
export type StudentGuardianRow = typeof studentGuardians.$inferSelect;
export type QrCredentialRow = typeof qrCredentials.$inferSelect;
export type EnrollmentRow = typeof enrollments.$inferSelect;

const ACTIVE_STATUS = "ACTIVE";
const REVOKED_STATUS = "REVOKED";

// ---------------------------------------------------------------------------
// Student code generation
// ---------------------------------------------------------------------------

/**
 * New student codes are 5-digit zero-padded strings ("NNNNN"), workspace-
 * scoped. This gives 99,999 codes per workspace — a ~20× safety margin
 * over the largest CUSTOM plan's active-student cap (~5,000), even
 * assuming perpetual code non-reuse (deleted students never free their
 * code — kept intentionally so printed / exported records stay unique
 * across time).
 *
 * Format decision (owner-approved Phase 4 UX task):
 *   • digits only, no letters, no dashes — trivial to read, dictate,
 *     and search on any keyboard.
 *   • zero-padded fixed length so the code is always exactly 5 chars,
 *     stored as `text` (never coerced to `number`, which would eat the
 *     leading zeros — that's why every field on the wire is a string).
 *
 * The legacy `AP-XXXXXX` shape produced by earlier releases is NOT
 * mass-migrated — existing rows keep their codes, and both the search
 * heuristic (`inferSearchMode` in the students service) and the DB's
 * free-form `text` column continue to accept them side by side.
 */
const STUDENT_CODE_DIGITS = 5;
const STUDENT_CODE_MAX_SEQUENCE = 10 ** STUDENT_CODE_DIGITS - 1; // 99999

/**
 * Postgres regex anchored on EXACTLY 5 digits — the shape the new
 * generator emits. Tightening this from `^[0-9]+$` to `^[0-9]{5}$` was a
 * deliberate safety-check step: a stray legacy row with a non-5-digit
 * pure-numeric code (unknown to us, hypothetical, but possible if a
 * script ever seeded such a value) is now IGNORED by the counter
 * instead of contributing to the next-seq calculation. The DB `UNIQUE`
 * constraint on `(workspace_id, student_code)` is the last-mile safety
 * net either way.
 */
const NUMERIC_CODE_REGEX_PG = `^[0-9]{${STUDENT_CODE_DIGITS}}$`;

function formatNumericStudentCode(sequence: number): string {
  return String(sequence).padStart(STUDENT_CODE_DIGITS, "0");
}

/**
 * Exhaustion error — thrown ONLY when a workspace has ever assigned every
 * numeric code from `00001` through `99999`. Callers surface this as a
 * platform-side event (contact support / raise limits), not a random 500.
 */
export class StudentCodeSpaceExhaustedError extends Error {
  readonly workspaceId: string;
  constructor(workspaceId: string) {
    super(`Workspace ${workspaceId} has exhausted the numeric student-code space (max ${STUDENT_CODE_MAX_SEQUENCE}).`);
    this.name = "StudentCodeSpaceExhaustedError";
    this.workspaceId = workspaceId;
  }
}

/**
 * Generate the next numeric student code for a workspace, serialised on
 * a transaction-scoped advisory lock so two concurrent creates in the
 * same workspace can never pick the same sequence:
 *
 *   1. `pg_advisory_xact_lock(hashtext(workspace_id))` — releases at
 *      commit/rollback automatically; two callers on the same workspace
 *      queue on this lock (no external ROW LOCK on `students` needed).
 *   2. `SELECT MAX(student_code::int) + 1 FROM students WHERE
 *       workspace_id = :ws AND student_code ~ '^[0-9]+$'` — only rows
 *       with an entirely-numeric legacy-safe code contribute; legacy
 *       `AP-XXXXXX` rows are skipped by the regex and never miscast.
 *   3. Return the zero-padded 5-digit string.
 *
 * Called INSIDE the same transaction that inserts the student
 * (`insertStudentWithUniqueCode` below), so the lock is held from the
 * moment the code is picked through the moment the row is written —
 * the classic advisory-lock idiom.
 */
export async function generateUniqueStudentCode(db: Db, workspaceId: string): Promise<string> {
  await db.execute(rawSql`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`);
  const [row] = await db.execute<{ next_seq: number }>(rawSql`
    SELECT COALESCE(MAX(student_code::int), 0) + 1 AS next_seq
    FROM students
    WHERE workspace_id = ${workspaceId}
      AND student_code ~ ${NUMERIC_CODE_REGEX_PG}
  `);
  const nextSeq = Number(row?.next_seq ?? 1);
  if (!Number.isFinite(nextSeq) || nextSeq > STUDENT_CODE_MAX_SEQUENCE) {
    throw new StudentCodeSpaceExhaustedError(workspaceId);
  }
  return formatNumericStudentCode(nextSeq);
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

export function findStudentById(db: Db, id: string): Promise<StudentRow | undefined> {
  return db.select().from(students).where(eq(students.id, id)).limit(1).then((rows) => rows[0]);
}

export interface InsertStudentInput {
  workspaceId: string;
  studentCode: string;
  name: string;
  searchNameNormalized: string;
}

export async function insertStudent(db: Db, input: InsertStudentInput): Promise<StudentRow> {
  const [inserted] = await db
    .insert(students)
    .values({
      workspaceId: input.workspaceId,
      studentCode: input.studentCode,
      name: input.name,
      searchNameNormalized: input.searchNameNormalized,
    })
    .returning();
  if (!inserted) throw new Error("Failed to insert students row.");
  return inserted;
}

/**
 * Concurrency-safe student creation.
 *
 * `generateUniqueStudentCode` runs INSIDE the same transaction as the
 * insert, so the advisory lock (`pg_advisory_xact_lock(hashtext(ws))`)
 * covers both the "pick next sequence" read AND the row write —
 * two concurrent creates on the same workspace serialise on the lock,
 * each seeing the other's committed row before assigning their own
 * code, and the DB's `UNIQUE(workspace_id, student_code)` constraint
 * is the final belt-and-braces defense.
 *
 * `db.transaction` composes cleanly when the caller ALREADY holds a
 * transaction (drizzle's own idempotency): a nested `db.transaction`
 * inside `withRuntimeContext` becomes a savepoint on the same
 * connection, which is exactly what we want here — the advisory lock
 * stays tied to the outer transaction's lifetime and releases at the
 * end of the whole request.
 *
 * Belt-and-braces: even under the advisory lock, we still use
 * `.onConflictDoNothing(...)` on the DB unique constraint and retry
 * once if the insert produced no row — the theoretical scenario is a
 * pool boundary where two callers somehow bypass the lock (should
 * not happen, but if it did, we recover instead of surfacing a 500).
 *
 * This does NOT dedup students by name/phone: a student has no
 * business identity key (identical names are real, distinct people,
 * and auto-merge is deliberately prohibited), so two concurrent
 * "create <same name>" requests correctly produce two distinct
 * students.
 */
export async function insertStudentWithUniqueCode(
  db: Db,
  input: { workspaceId: string; name: string; searchNameNormalized: string },
): Promise<StudentRow> {
  return db.transaction(async (tx) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const code = await generateUniqueStudentCode(tx, input.workspaceId);
      const [inserted] = await tx
        .insert(students)
        .values({
          workspaceId: input.workspaceId,
          studentCode: code,
          name: input.name,
          searchNameNormalized: input.searchNameNormalized,
        })
        .onConflictDoNothing({ target: [students.workspaceId, students.studentCode] })
        .returning();
      if (inserted) return inserted;
      // No row = a concurrent insert grabbed this exact code between our
      // lock-scoped read and the write (extremely unlikely under the
      // advisory lock, but the retry costs nothing). Re-generate and try
      // once more; a second miss surfaces as an explicit error rather
      // than a silent infinite loop.
    }
    throw new Error("Failed to insert a student with a unique student_code after 2 attempts.");
  });
}

export interface UpdateStudentInput {
  name?: string;
  searchNameNormalized?: string;
  status?: "ACTIVE" | "ARCHIVED";
  archivedAt?: Date | null;
}

export async function updateStudentWithVersion(
  db: Db,
  id: string,
  expectedVersion: number,
  patch: UpdateStudentInput,
): Promise<StudentRow | undefined> {
  const [updated] = await db
    .update(students)
    .set({ ...patch, updatedAt: new Date(), version: expectedVersion + 1 })
    .where(and(eq(students.id, id), eq(students.version, expectedVersion)))
    .returning();
  return updated;
}

export interface StudentSearchFilter {
  workspaceId: string;
  /** Arabic-normalized query, already run through arabic-normalize.ts. */
  normalizedNameQuery?: string;
  studentCode?: string;
  /** Normalized guardian phone (exact match, joins through student_guardians/guardians). */
  guardianNormalizedPhone?: string;
  limit: number;
  cursorId?: string;
  /**
   * Student Group-Scope Security Delta: when the caller's effective grant
   * for `students.view_basic`/`students.edit` is SELECTED_GROUPS (not
   * ALL_GROUPS/Owner), the application layer passes the caller's granted
   * group ids here and every branch below is additionally restricted to
   * students who have (or have had) at least one Enrollment tied to a
   * GroupMonth of one of these groups. `undefined` means "no restriction"
   * (ALL_GROUPS/Owner caller); an explicit empty array means "restricted,
   * but zero groups granted" and must match nothing, not everything.
   */
  restrictToGroupIds?: string[];
}

/**
 * Subquery of student ids that have (or have had) at least one Enrollment
 * anchored to a GroupMonth of one of `groupIds` — the only real link
 * between a Student and a Group, since `students`/`guardians` carry no
 * `group_id` column of their own (documented architecture decision, see
 * `StudentsService`'s doc comment). Deliberately NOT filtered by enrollment
 * status: a SELECTED_GROUPS assistant who once managed a since-withdrawn/
 * transferred student in their own group keeps visibility into that
 * historical record — only students with NO enrollment ever tied to any of
 * the caller's granted groups are out of scope.
 */
function studentsInGroupScopeSubquery(db: Db, groupIds: string[]) {
  return db
    .select({ studentId: enrollments.studentId })
    .from(enrollments)
    .innerJoin(groupMonths, eq(groupMonths.id, enrollments.groupMonthId))
    .where(inArray(groupMonths.groupId, groupIds));
}

/**
 * Scoped directory/search (API Contract §13). Exactly one lookup mode is
 * expected per call (name fuzzy XOR student_code exact XOR guardian phone
 * exact) — the service layer picks the mode; this function just executes
 * whichever filter(s) are supplied. pg_trgm `similarity()` backs the fuzzy
 * name path via the GIN index created in migration 0015.
 */
export async function searchStudents(db: Db, filter: StudentSearchFilter): Promise<StudentRow[]> {
  const scopeCondition =
    filter.restrictToGroupIds === undefined
      ? undefined
      : filter.restrictToGroupIds.length === 0
        ? rawSql`false` // SELECTED_GROUPS caller with zero granted groups — matches nothing
        : inArray(students.id, studentsInGroupScopeSubquery(db, filter.restrictToGroupIds));

  if (filter.studentCode) {
    // Phase 15: deterministic ordering (the (workspace, code) unique makes
    // this ≤1 row in practice, but LIMIT-without-ORDER-BY is never OK).
    const conditions = [eq(students.workspaceId, filter.workspaceId), eq(students.studentCode, filter.studentCode)];
    if (scopeCondition) conditions.push(scopeCondition);
    return db
      .select()
      .from(students)
      .where(and(...conditions))
      .orderBy(asc(students.id))
      .limit(filter.limit);
  }

  if (filter.guardianNormalizedPhone) {
    // Phase 15 fix: this branch ignored `cursorId` while the service still
    // emitted a nextCursor from it — paging a phone search returned the
    // same first page forever. Now honors the cursor like the plain list.
    const conditions = [
      eq(students.workspaceId, filter.workspaceId),
      eq(guardians.normalizedPhone, filter.guardianNormalizedPhone),
    ];
    if (filter.cursorId) conditions.push(gt(students.id, filter.cursorId));
    if (scopeCondition) conditions.push(scopeCondition);
    const rows = await db
      .selectDistinct({ student: students })
      .from(students)
      .innerJoin(studentGuardians, eq(studentGuardians.studentId, students.id))
      .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
      .where(and(...conditions))
      .orderBy(asc(students.id))
      .limit(filter.limit);
    return rows.map((r) => r.student);
  }

  if (filter.normalizedNameQuery) {
    const conditions = [
      eq(students.workspaceId, filter.workspaceId),
      rawSql`${students.searchNameNormalized} % ${filter.normalizedNameQuery}`,
    ];
    if (filter.cursorId) conditions.push(gt(students.id, filter.cursorId));
    if (scopeCondition) conditions.push(scopeCondition);
    return db
      .select()
      .from(students)
      .where(and(...conditions))
      .orderBy(rawSql`similarity(${students.searchNameNormalized}, ${filter.normalizedNameQuery}) DESC`, asc(students.id))
      .limit(filter.limit);
  }

  // No query at all: plain workspace-scoped listing, cursor-paginated by id.
  const conditions = [eq(students.workspaceId, filter.workspaceId)];
  if (filter.cursorId) conditions.push(gt(students.id, filter.cursorId));
  if (scopeCondition) conditions.push(scopeCondition);
  return db
    .select()
    .from(students)
    .where(and(...conditions))
    .orderBy(asc(students.id))
    .limit(filter.limit);
}

/**
 * All distinct Group ids a Student has ever been Enrolled into (via any
 * GroupMonth, any enrollment status). The Group-Scope Security Delta's
 * primary read helper: the application layer intersects this against the
 * caller's SELECTED_GROUPS grant to decide per-student visibility for every
 * Student/Guardian/QR/Enrollment operation.
 */
export async function listGroupIdsForStudent(db: Db, studentId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ groupId: groupMonths.groupId })
    .from(enrollments)
    .innerJoin(groupMonths, eq(groupMonths.id, enrollments.groupMonthId))
    .where(eq(enrollments.studentId, studentId));
  return rows.map((r) => r.groupId);
}

export interface EnrollmentHistoryRow {
  enrollment: EnrollmentRow;
  groupId: string;
  groupName: string;
  year: number;
  month: number;
}

/**
 * A student's full enrollment history — every enrollment (any status) joined to
 * its group (name) and operating month, newest first. ONE query (no N+1); RLS
 * (app.workspace_id) keeps it within the caller's workspace. The application
 * layer additionally enforces student/group scope before calling this.
 */
export async function listEnrollmentsForStudentWithGroup(db: Db, studentId: string): Promise<EnrollmentHistoryRow[]> {
  const rows = await db
    .select({
      enrollment: enrollments,
      groupId: groups.id,
      groupName: groups.name,
      year: operatingMonths.year,
      month: operatingMonths.month,
    })
    .from(enrollments)
    .innerJoin(groupMonths, eq(groupMonths.id, enrollments.groupMonthId))
    .innerJoin(groups, eq(groups.id, groupMonths.groupId))
    .innerJoin(operatingMonths, eq(operatingMonths.id, groupMonths.operatingMonthId))
    .where(eq(enrollments.studentId, studentId))
    .orderBy(desc(operatingMonths.year), desc(operatingMonths.month), desc(enrollments.createdAt));
  return rows.map((r) => ({ enrollment: r.enrollment, groupId: r.groupId, groupName: r.groupName, year: r.year, month: r.month }));
}

// ---------------------------------------------------------------------------
// Guardians / student_guardians
// ---------------------------------------------------------------------------

export interface InsertGuardianInput {
  workspaceId: string;
  name?: string | null;
  phone: string;
  normalizedPhone: string;
}

export async function insertGuardian(db: Db, input: InsertGuardianInput): Promise<GuardianRow> {
  const [inserted] = await db
    .insert(guardians)
    .values({
      workspaceId: input.workspaceId,
      name: input.name ?? null,
      phone: input.phone,
      normalizedPhone: input.normalizedPhone,
    })
    .returning();
  if (!inserted) throw new Error("Failed to insert guardians row.");
  return inserted;
}

export function findGuardianById(db: Db, id: string): Promise<GuardianRow | undefined> {
  return db.select().from(guardians).where(eq(guardians.id, id)).limit(1).then((rows) => rows[0]);
}

export interface InsertStudentGuardianInput {
  workspaceId: string;
  studentId: string;
  guardianId: string;
  relationship?: string | null;
  isPrimary: boolean;
  academicContactEnabled: boolean;
  financialContactEnabled: boolean;
}

export async function insertStudentGuardian(
  db: Db,
  input: InsertStudentGuardianInput,
): Promise<StudentGuardianRow> {
  const [inserted] = await db
    .insert(studentGuardians)
    .values({
      workspaceId: input.workspaceId,
      studentId: input.studentId,
      guardianId: input.guardianId,
      relationship: input.relationship ?? null,
      isPrimary: input.isPrimary,
      academicContactEnabled: input.academicContactEnabled,
      financialContactEnabled: input.financialContactEnabled,
    })
    .returning();
  if (!inserted) throw new Error("Failed to insert student_guardians row.");
  return inserted;
}

export function findStudentGuardianById(db: Db, id: string): Promise<StudentGuardianRow | undefined> {
  return db.select().from(studentGuardians).where(eq(studentGuardians.id, id)).limit(1).then((rows) => rows[0]);
}

export interface StudentGuardianWithGuardian {
  link: StudentGuardianRow;
  guardian: GuardianRow;
}

export async function listGuardiansForStudent(db: Db, studentId: string): Promise<StudentGuardianWithGuardian[]> {
  const rows = await db
    .select({ link: studentGuardians, guardian: guardians })
    .from(studentGuardians)
    .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
    .where(eq(studentGuardians.studentId, studentId));
  return rows;
}

export interface UpdateStudentGuardianInput {
  relationship?: string | null;
  academicContactEnabled?: boolean;
  financialContactEnabled?: boolean;
}

export async function updateStudentGuardian(
  db: Db,
  id: string,
  patch: UpdateStudentGuardianInput,
): Promise<StudentGuardianRow | undefined> {
  const [updated] = await db
    .update(studentGuardians)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(studentGuardians.id, id))
    .returning();
  return updated;
}

/**
 * Atomically unsets any existing primary guardian for `studentId` and sets
 * `guardianLinkId` as primary — implemented as two UPDATEs inside one
 * transaction so INT-03's partial UNIQUE index is never violated
 * mid-operation (unset-then-set never has two rows simultaneously
 * `is_primary = true`).
 */
export async function setPrimaryGuardianTransaction(
  db: Db,
  studentId: string,
  guardianLinkId: string,
): Promise<StudentGuardianRow | undefined> {
  return db.transaction(async (tx) => {
    await tx
      .update(studentGuardians)
      .set({ isPrimary: false, updatedAt: new Date() })
      .where(and(eq(studentGuardians.studentId, studentId), eq(studentGuardians.isPrimary, true)));

    const [updated] = await tx
      .update(studentGuardians)
      .set({ isPrimary: true, updatedAt: new Date() })
      .where(and(eq(studentGuardians.id, guardianLinkId), eq(studentGuardians.studentId, studentId)))
      .returning();
    return updated;
  });
}

// ---------------------------------------------------------------------------
// QR credentials
// ---------------------------------------------------------------------------

export function findActiveQrForStudent(db: Db, studentId: string): Promise<QrCredentialRow | undefined> {
  return db
    .select()
    .from(qrCredentials)
    .where(and(eq(qrCredentials.studentId, studentId), eq(qrCredentials.status, ACTIVE_STATUS)))
    .limit(1)
    .then((rows) => rows[0]);
}

export function findQrByTokenHash(db: Db, tokenHash: string): Promise<QrCredentialRow | undefined> {
  return db
    .select()
    .from(qrCredentials)
    .where(and(eq(qrCredentials.tokenHash, tokenHash), eq(qrCredentials.status, ACTIVE_STATUS)))
    .limit(1)
    .then((rows) => rows[0]);
}

export interface IssueQrInput {
  workspaceId: string;
  studentId: string;
  tokenHash: string;
  issuedByUserId: string;
}

/** Plain issue — caller must have already verified no ACTIVE credential exists (service layer, 409 on conflict); the partial UNIQUE index is the DB-level backstop. */
export async function issueQrCredential(db: Db, input: IssueQrInput): Promise<QrCredentialRow> {
  const [inserted] = await db
    .insert(qrCredentials)
    .values({
      workspaceId: input.workspaceId,
      studentId: input.studentId,
      tokenHash: input.tokenHash,
      status: ACTIVE_STATUS,
      issuedByUserId: input.issuedByUserId,
    })
    .returning();
  if (!inserted) throw new Error("Failed to insert qr_credentials row.");
  return inserted;
}

export interface ReissueQrInput {
  workspaceId: string;
  studentId: string;
  newTokenHash: string;
  issuedByUserId: string;
  revokedByUserId: string;
  revokeReason?: string | null;
}

/**
 * Transactionally revokes the current ACTIVE credential for `studentId` (if
 * any) and issues a fresh one. Works whether or not an active credential
 * currently exists (§33.3 reissue semantics — see Phase 4 handoff
 * DEVIATIONS for why `/reissue` is defined to also work as a first issue).
 */
export async function reissueQrCredentialTransaction(
  db: Db,
  input: ReissueQrInput,
): Promise<{ revoked: QrCredentialRow | null; issued: QrCredentialRow }> {
  return db.transaction(async (tx) => {
    const [active] = await tx
      .select()
      .from(qrCredentials)
      .where(and(eq(qrCredentials.studentId, input.studentId), eq(qrCredentials.status, ACTIVE_STATUS)))
      .limit(1);

    let revoked: QrCredentialRow | null = null;
    if (active) {
      const now = new Date();
      const [updated] = await tx
        .update(qrCredentials)
        .set({
          status: REVOKED_STATUS,
          revokedAt: now,
          revokeReason: input.revokeReason ?? "REISSUED",
          revokedByUserId: input.revokedByUserId,
        })
        .where(eq(qrCredentials.id, active.id))
        .returning();
      if (!updated) throw new Error("Failed to revoke previous qr_credentials row.");
      revoked = updated;
    }

    const [issued] = await tx
      .insert(qrCredentials)
      .values({
        workspaceId: input.workspaceId,
        studentId: input.studentId,
        tokenHash: input.newTokenHash,
        status: ACTIVE_STATUS,
        issuedByUserId: input.issuedByUserId,
      })
      .returning();
    if (!issued) throw new Error("Failed to insert reissued qr_credentials row.");

    return { revoked, issued };
  });
}

// ---------------------------------------------------------------------------
// Sessions (read-only, for proration — reuses the sessions table directly
// rather than importing scheduling.repository.ts's listSessions, keeping
// this module's public surface self-contained).
// ---------------------------------------------------------------------------

export function listSessionsForGroupMonth(db: Db, groupMonthId: string): Promise<SessionRow[]> {
  return db.select().from(sessions).where(eq(sessions.groupMonthId, groupMonthId));
}

// ---------------------------------------------------------------------------
// Enrollments
// ---------------------------------------------------------------------------

export function findEnrollmentById(db: Db, id: string): Promise<EnrollmentRow | undefined> {
  return db.select().from(enrollments).where(eq(enrollments.id, id)).limit(1).then((rows) => rows[0]);
}

export function findEnrollmentByStudentAndGroupMonth(
  db: Db,
  studentId: string,
  groupMonthId: string,
): Promise<EnrollmentRow | undefined> {
  return db
    .select()
    .from(enrollments)
    .where(and(eq(enrollments.studentId, studentId), eq(enrollments.groupMonthId, groupMonthId)))
    .limit(1)
    .then((rows) => rows[0]);
}

export interface CreateOrReactivateEnrollmentInput {
  workspaceId: string;
  studentId: string;
  groupMonthId: string;
  joinDate: string; // "YYYY-MM-DD"
  status: "PENDING" | "ACTIVE";
  feeMethod: "FULL_MONTH" | "CUSTOM" | "REMAINING_SESSIONS";
  customFeeMinor?: number | null;
  /** Phase 6 — the FinancialObligation terms for this join; see `upsertObligationForEnrollment`'s own doc comment for the create-vs-refresh-vs-leave-alone rule. */
  obligation: ObligationTerms;
}

/**
 * INT-08 reactivation path: if a row already exists for
 * (student_id, group_month_id) — regardless of its current status — it is
 * UPDATED (join_date/status/fee_method/custom_fee_minor refreshed,
 * ended_at/end_reason cleared, version bumped) rather than a second row
 * being inserted, which the UNIQUE constraint would reject anyway. This is
 * the explicit "clean re-activation path, not a raw 500 on unique
 * violation" the phase brief calls for.
 *
 * Phase 6: also upserts the Enrollment's FinancialObligation in the SAME
 * transaction — "Enrollment + obligation transaction" per API Contract
 * §9.5's own endpoint description (previously deferred — Phase 4 pre-
 * authorized scoping decision #1, closed now).
 */
export async function createOrReactivateEnrollmentTransaction(
  db: Db,
  input: CreateOrReactivateEnrollmentInput,
): Promise<{ enrollment: EnrollmentRow; reactivated: boolean; obligation: FinancialObligationRow }> {
  return db.transaction(async (tx) => {
    // Billing Phase 2 — capacity is enforced first, inside the tx, only when the
    // join becomes ACTIVE (PENDING adds no active-student usage). Takes the
    // per-workspace subscription row lock, so concurrent joins can't both slip
    // past the limit. A student already active this month (another group) adds
    // no unique usage and is allowed even at the cap.
    if (input.status === "ACTIVE") {
      await assertStudentCapacityForEnrollment(tx, {
        workspaceId: input.workspaceId,
        studentId: input.studentId,
        targetGroupMonthId: input.groupMonthId,
      });
    }

    const [existing] = await tx
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.studentId, input.studentId), eq(enrollments.groupMonthId, input.groupMonthId)))
      .limit(1);

    let enrollment: EnrollmentRow;
    let reactivated: boolean;
    if (existing) {
      const [updated] = await tx
        .update(enrollments)
        .set({
          joinDate: input.joinDate,
          status: input.status,
          feeMethod: input.feeMethod,
          customFeeMinor: input.customFeeMinor ?? null,
          endedAt: null,
          endReason: null,
          updatedAt: new Date(),
          version: existing.version + 1,
        })
        .where(eq(enrollments.id, existing.id))
        .returning();
      if (!updated) throw new Error("Failed to reactivate enrollments row.");
      enrollment = updated;
      reactivated = true;
    } else {
      // Atomic upsert on the `enrollments_student_group_month_unique`
      // (student_id, group_month_id) constraint. If a concurrent request
      // created this exact enrollment between our SELECT above and this INSERT
      // (the classic check-then-insert race — unserialized for PENDING joins,
      // which take no capacity lock), we reactivate that row to the requested
      // state instead of letting the DB raise a 23505 that would surface as a
      // generic 500 to the user who merely lost the race. Same intent →
      // same clean result as the winner. A fresh insert lands at version 1;
      // the ON CONFLICT path bumps version past 1, which is how we tell a real
      // create from a race-reactivation so the audit log never records two
      // "enrollment.created" events for one row.
      const [row] = await tx
        .insert(enrollments)
        .values({
          workspaceId: input.workspaceId,
          studentId: input.studentId,
          groupMonthId: input.groupMonthId,
          joinDate: input.joinDate,
          status: input.status,
          feeMethod: input.feeMethod,
          customFeeMinor: input.customFeeMinor ?? null,
        })
        .onConflictDoUpdate({
          target: [enrollments.studentId, enrollments.groupMonthId],
          set: {
            joinDate: input.joinDate,
            status: input.status,
            feeMethod: input.feeMethod,
            customFeeMinor: input.customFeeMinor ?? null,
            endedAt: null,
            endReason: null,
            updatedAt: new Date(),
            version: rawSql`${enrollments.version} + 1`,
          },
        })
        .returning();
      if (!row) throw new Error("Failed to insert enrollments row.");
      enrollment = row;
      reactivated = row.version > 1;
    }

    const { obligation } = await upsertObligationForEnrollment(tx, {
      workspaceId: input.workspaceId,
      enrollmentId: enrollment.id,
      ...input.obligation,
    });

    return { enrollment, reactivated, obligation };
  });
}

export interface WithdrawEnrollmentInput {
  id: string;
  reason?: string | null;
  effectiveDate?: Date;
}

export async function withdrawEnrollment(
  db: Db,
  input: WithdrawEnrollmentInput,
): Promise<EnrollmentRow | undefined> {
  const [updated] = await db
    .update(enrollments)
    .set({
      status: "WITHDRAWN",
      endedAt: input.effectiveDate ?? new Date(),
      endReason: input.reason ?? null,
      updatedAt: new Date(),
      version: rawSql`${enrollments.version} + 1`,
    })
    .where(and(eq(enrollments.id, input.id), isNull(enrollments.endedAt)))
    .returning();
  return updated;
}

export interface TransferEnrollmentTransactionInput {
  sourceEnrollmentId: string;
  targetGroupMonthId: string;
  targetWorkspaceId: string;
  joinDate: string;
  status: "PENDING" | "ACTIVE";
  feeMethod: "FULL_MONTH" | "CUSTOM" | "REMAINING_SESSIONS";
  customFeeMinor?: number | null;
  /** Phase 6 — obligation terms for the TARGET enrollment only; the source enrollment's own obligation (if any) is deliberately left untouched — same "old debt stays independent, never auto-adjusted" reasoning as withdrawal. */
  obligation: ObligationTerms;
}

/**
 * Transactionally ends the source enrollment (status=TRANSFERRED,
 * end_reason='TRANSFER') and creates/reactivates the target enrollment for
 * the SAME student_id — Student identity never changes across a transfer.
 * Phase 6: also upserts the TARGET's FinancialObligation in the same
 * transaction (see `CreateOrReactivateEnrollmentInput`'s doc comment).
 */
export async function transferEnrollmentTransaction(
  db: Db,
  input: TransferEnrollmentTransactionInput,
): Promise<{ source: EnrollmentRow; target: EnrollmentRow; reactivated: boolean; obligation: FinancialObligationRow } | undefined> {
  return db.transaction(async (tx) => {
    const [source] = await tx
      .select()
      .from(enrollments)
      .where(eq(enrollments.id, input.sourceEnrollmentId))
      .limit(1);
    if (!source) return undefined;

    // Billing Phase 2 — capacity check BEFORE ending the source, so a within-
    // month transfer (student already active in the current month) is net-zero
    // and always allowed; only a transfer that makes the student newly active
    // in the current month beyond the cap is refused.
    if (input.status === "ACTIVE") {
      await assertStudentCapacityForEnrollment(tx, {
        workspaceId: input.targetWorkspaceId,
        studentId: source.studentId,
        targetGroupMonthId: input.targetGroupMonthId,
      });
    }

    const now = new Date();
    const [updatedSource] = await tx
      .update(enrollments)
      .set({
        status: "TRANSFERRED",
        endedAt: now,
        endReason: "TRANSFER",
        updatedAt: now,
        version: source.version + 1,
      })
      .where(eq(enrollments.id, source.id))
      .returning();
    if (!updatedSource) throw new Error("Failed to end source enrollment.");

    const [existingTarget] = await tx
      .select()
      .from(enrollments)
      .where(
        and(eq(enrollments.studentId, source.studentId), eq(enrollments.groupMonthId, input.targetGroupMonthId)),
      )
      .limit(1);

    let target: EnrollmentRow;
    let reactivated = false;
    if (existingTarget) {
      const [updatedTarget] = await tx
        .update(enrollments)
        .set({
          joinDate: input.joinDate,
          status: input.status,
          feeMethod: input.feeMethod,
          customFeeMinor: input.customFeeMinor ?? null,
          endedAt: null,
          endReason: null,
          updatedAt: now,
          version: existingTarget.version + 1,
        })
        .where(eq(enrollments.id, existingTarget.id))
        .returning();
      if (!updatedTarget) throw new Error("Failed to reactivate target enrollment.");
      target = updatedTarget;
      reactivated = true;
    } else {
      const [insertedTarget] = await tx
        .insert(enrollments)
        .values({
          workspaceId: input.targetWorkspaceId,
          studentId: source.studentId,
          groupMonthId: input.targetGroupMonthId,
          joinDate: input.joinDate,
          status: input.status,
          feeMethod: input.feeMethod,
          customFeeMinor: input.customFeeMinor ?? null,
        })
        .returning();
      if (!insertedTarget) throw new Error("Failed to insert target enrollment.");
      target = insertedTarget;
    }

    const { obligation } = await upsertObligationForEnrollment(tx, {
      workspaceId: input.targetWorkspaceId,
      enrollmentId: target.id,
      ...input.obligation,
    });

    return { source: updatedSource, target, reactivated, obligation };
  });
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface StudentsAuditEventInput {
  workspaceId: string;
  actorUserId: string | null;
  actorMembershipId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  beforeJson?: unknown;
  afterJson?: unknown;
  reason?: string | null;
  correlationId?: string | null;
}

export async function insertStudentsAuditEvent(db: Db, input: StudentsAuditEventInput): Promise<void> {
  await db.insert(auditEvents).values({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    actorMembershipId: input.actorMembershipId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    beforeJson: input.beforeJson ?? null,
    afterJson: input.afterJson ?? null,
    reason: input.reason ?? null,
    correlationId: input.correlationId ?? null,
  });
}

