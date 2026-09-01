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

const STUDENT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I — avoids visual ambiguity
const STUDENT_CODE_SUFFIX_LENGTH = 6;
const STUDENT_CODE_MAX_ATTEMPTS = 10;

function randomStudentCodeSuffix(): string {
  let out = "";
  for (let i = 0; i < STUDENT_CODE_SUFFIX_LENGTH; i += 1) {
    out += STUDENT_CODE_ALPHABET[Math.floor(Math.random() * STUDENT_CODE_ALPHABET.length)];
  }
  return out;
}

/**
 * Generates a stable, human-facing, workspace-scoped student code:
 * `AP-XXXXXX` where `XXXXXX` is 6 random characters from a 33-symbol
 * alphabet excluding visually-ambiguous characters (0/O, 1/I). This gives
 * ~33^6 (~1.3 billion) combinations per workspace, checked against the
 * `UNIQUE(workspace_id, student_code)` constraint with a small retry loop —
 * collision probability is negligible for any realistic single workspace's
 * student count, and the retry loop makes the (tiny) residual risk a
 * non-issue rather than a hard failure. Not sequential — sequential codes
 * would require either a per-workspace counter table (extra write
 * contention/complexity not justified for a display code) or leaking
 * enrollment-order information the product doesn't need to expose.
 */
export async function generateUniqueStudentCode(db: Db, workspaceId: string): Promise<string> {
  for (let attempt = 0; attempt < STUDENT_CODE_MAX_ATTEMPTS; attempt += 1) {
    const candidate = `AP-${randomStudentCodeSuffix()}`;
    const existing = await db
      .select({ id: students.id })
      .from(students)
      .where(and(eq(students.workspaceId, workspaceId), eq(students.studentCode, candidate)))
      .limit(1);
    if (existing.length === 0) return candidate;
  }
  throw new Error("Failed to generate a unique student_code after multiple attempts.");
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
      const [inserted] = await tx
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
        .returning();
      if (!inserted) throw new Error("Failed to insert enrollments row.");
      enrollment = inserted;
      reactivated = false;
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

