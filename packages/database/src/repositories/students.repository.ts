/**
 * Students / Guardians / QR / Enrollment repository — Phase 4.
 *
 * Typed query helpers + transactional operations, containing no HTTP/
 * framework concerns — mirrors `scheduling.repository.ts`'s convention
 * exactly. Business/authorization decisions (permission checks, preview-
 * token validation) live in apps/api's application service layer, NOT here.
 */
import { and, asc, eq, gt, isNull, sql as rawSql } from "drizzle-orm";
import { students } from "../schema/students";
import { guardians, studentGuardians } from "../schema/guardians";
import { qrCredentials } from "../schema/qr-credentials";
import { enrollments } from "../schema/enrollments";
import { sessions } from "../schema/sessions";
import { auditEvents } from "../schema/audit";
import type { Db } from "./identity.repository";
// `SessionRow` is already exported by scheduling.repository.ts (same
// underlying `sessions` table) — re-used here (not redeclared) to avoid a
// duplicate-export name collision at the package barrel.
import type { SessionRow } from "./scheduling.repository";

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
}

/**
 * Scoped directory/search (API Contract §13). Exactly one lookup mode is
 * expected per call (name fuzzy XOR student_code exact XOR guardian phone
 * exact) — the service layer picks the mode; this function just executes
 * whichever filter(s) are supplied. pg_trgm `similarity()` backs the fuzzy
 * name path via the GIN index created in migration 0015.
 */
export async function searchStudents(db: Db, filter: StudentSearchFilter): Promise<StudentRow[]> {
  if (filter.studentCode) {
    return db
      .select()
      .from(students)
      .where(and(eq(students.workspaceId, filter.workspaceId), eq(students.studentCode, filter.studentCode)))
      .limit(filter.limit);
  }

  if (filter.guardianNormalizedPhone) {
    const rows = await db
      .selectDistinct({ student: students })
      .from(students)
      .innerJoin(studentGuardians, eq(studentGuardians.studentId, students.id))
      .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
      .where(
        and(
          eq(students.workspaceId, filter.workspaceId),
          eq(guardians.normalizedPhone, filter.guardianNormalizedPhone),
        ),
      )
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
  return db
    .select()
    .from(students)
    .where(and(...conditions))
    .orderBy(asc(students.id))
    .limit(filter.limit);
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
}

/**
 * INT-08 reactivation path: if a row already exists for
 * (student_id, group_month_id) — regardless of its current status — it is
 * UPDATED (join_date/status/fee_method/custom_fee_minor refreshed,
 * ended_at/end_reason cleared, version bumped) rather than a second row
 * being inserted, which the UNIQUE constraint would reject anyway. This is
 * the explicit "clean re-activation path, not a raw 500 on unique
 * violation" the phase brief calls for.
 */
export async function createOrReactivateEnrollmentTransaction(
  db: Db,
  input: CreateOrReactivateEnrollmentInput,
): Promise<{ enrollment: EnrollmentRow; reactivated: boolean }> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.studentId, input.studentId), eq(enrollments.groupMonthId, input.groupMonthId)))
      .limit(1);

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
      return { enrollment: updated, reactivated: true };
    }

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
    return { enrollment: inserted, reactivated: false };
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
}

/**
 * Transactionally ends the source enrollment (status=TRANSFERRED,
 * end_reason='TRANSFER') and creates/reactivates the target enrollment for
 * the SAME student_id — Student identity never changes across a transfer.
 */
export async function transferEnrollmentTransaction(
  db: Db,
  input: TransferEnrollmentTransactionInput,
): Promise<{ source: EnrollmentRow; target: EnrollmentRow; reactivated: boolean } | undefined> {
  return db.transaction(async (tx) => {
    const [source] = await tx
      .select()
      .from(enrollments)
      .where(eq(enrollments.id, input.sourceEnrollmentId))
      .limit(1);
    if (!source) return undefined;

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

    return { source: updatedSource, target, reactivated };
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

