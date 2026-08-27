/**
 * Attention / Follow-up repository — Phase 7.
 *
 * Typed query helpers + transactional operations, containing no HTTP/
 * framework concerns — mirrors `session-mode.repository.ts`'s/
 * `finance.repository.ts`'s convention exactly. Business/authorization
 * decisions (permission checks, Group-Scope filtering) live in apps/api's
 * application service layer, NOT here — this module only guarantees
 * mechanical transactional integrity and, for `runEvaluateAttentionRules
 * ForSessionTransaction`, the actual rule-engine glue (called by the
 * outbox dispatcher, `app_worker` role, never `app_runtime`).
 */
import { and, asc, desc, eq, inArray, sql as rawSql } from "drizzle-orm";
import { attentionCases, attentionEvidence, attentionReasons } from "../schema/attention";
import { contactLogs, scheduledFollowups } from "../schema/followup";
import { sessions } from "../schema/sessions";
import { sessionExams } from "../schema/session-exams";
import { sessionRecords } from "../schema/session-records";
import { enrollments } from "../schema/enrollments";
import { groupMonths, groups } from "../schema/groups";
import { students } from "../schema/students";
import { auditEvents } from "../schema/audit";
import { outboxEvents } from "../schema/outbox";
import type { Db } from "./identity.repository";
import {
  evaluateRulesForGroup,
  type RuleEngineSessionRecordInput,
  type RuleMatch,
} from "../attention/rule-engine";

export type AttentionCaseRow = typeof attentionCases.$inferSelect;
export type AttentionReasonRow = typeof attentionReasons.$inferSelect;
export type AttentionEvidenceRow = typeof attentionEvidence.$inferSelect;
export type ContactLogRow = typeof contactLogs.$inferSelect;
export type ScheduledFollowupRow = typeof scheduledFollowups.$inferSelect;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function findAttentionCaseById(db: Db, id: string): Promise<AttentionCaseRow | undefined> {
  return db.select().from(attentionCases).where(eq(attentionCases.id, id)).limit(1).then((r) => r[0]);
}

export function listAttentionReasonsForCase(db: Db, attentionCaseId: string): Promise<AttentionReasonRow[]> {
  return db.select().from(attentionReasons).where(eq(attentionReasons.attentionCaseId, attentionCaseId));
}

/**
 * Phase 15C — batched (single `inArray` query, no N+1) counterpart of
 * {@link listAttentionReasonsForCase}. `GET /attention-cases` used to call
 * the single-case version once PER listed case (a genuine per-row fan-out —
 * N extra RLS transactions per page); this fetches every listed case's
 * Reasons in one query. Grouping by `attentionCaseId` back into per-case
 * arrays is the caller's job. Returns `[]` for an empty id set (no query).
 */
export function listAttentionReasonsForCases(db: Db, attentionCaseIds: string[]): Promise<AttentionReasonRow[]> {
  if (attentionCaseIds.length === 0) return Promise.resolve([]);
  return db.select().from(attentionReasons).where(inArray(attentionReasons.attentionCaseId, attentionCaseIds));
}

export async function listAttentionEvidenceForReasons(
  db: Db,
  attentionReasonIds: string[],
): Promise<AttentionEvidenceRow[]> {
  if (attentionReasonIds.length === 0) return [];
  return db
    .select()
    .from(attentionEvidence)
    .where(inArray(attentionEvidence.attentionReasonId, attentionReasonIds))
    .orderBy(desc(attentionEvidence.observedAt));
}

/** Every distinct Group a Case's Reasons currently reference — the exact set a caller's Group Scope is checked against (§ Attention Case + multi-group security correction). */
export async function listGroupIdsForAttentionCase(db: Db, attentionCaseId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ groupId: attentionReasons.groupId })
    .from(attentionReasons)
    .where(eq(attentionReasons.attentionCaseId, attentionCaseId));
  return rows.map((r) => r.groupId);
}

export interface ListAttentionCasesFilter {
  workspaceId: string;
  status?: string;
  /** `undefined` = unrestricted (ALL_GROUPS/Owner). A (possibly empty) array restricts to cases with at least one Reason in one of these groups. */
  restrictToGroupIds?: string[];
  limit: number;
  cursorId?: string;
}

export async function listAttentionCasesForWorkspace(
  db: Db,
  filter: ListAttentionCasesFilter,
): Promise<AttentionCaseRow[]> {
  const conditions = [eq(attentionCases.workspaceId, filter.workspaceId)];
  if (filter.status) conditions.push(eq(attentionCases.status, filter.status));
  if (filter.cursorId) conditions.push(rawSql`${attentionCases.id} > ${filter.cursorId}`);

  if (filter.restrictToGroupIds !== undefined) {
    if (filter.restrictToGroupIds.length === 0) {
      return [];
    }
    // Only cases that have at least one Reason in one of the caller's
    // groups — a case whose evidence is entirely outside scope must not
    // even be listed (safe no-leak).
    const rows = await db
      .selectDistinct({ c: attentionCases })
      .from(attentionCases)
      .innerJoin(attentionReasons, eq(attentionReasons.attentionCaseId, attentionCases.id))
      .where(and(...conditions, inArray(attentionReasons.groupId, filter.restrictToGroupIds)))
      .orderBy(asc(attentionCases.id))
      .limit(filter.limit);
    return rows.map((r) => r.c);
  }

  return db
    .select()
    .from(attentionCases)
    .where(and(...conditions))
    .orderBy(asc(attentionCases.id))
    .limit(filter.limit);
}

/**
 * Phase 11 — a small, additive batched lookup (single `inArray` query, no
 * N+1) so `GET /attention-cases` can include each case's student
 * name/code without the frontend re-fetching it per row. The list query
 * itself deliberately stays student-agnostic (it already filters by
 * Group-Scope via `attentionReasons`, not by anything student-owned), so
 * this is a separate, explicit, minimal join rather than baking a
 * students join into the cursor-paginated query above.
 */
export function listStudentNamesByIds(db: Db, workspaceId: string, studentIds: string[]): Promise<Array<{ id: string; name: string; studentCode: string }>> {
  if (studentIds.length === 0) return Promise.resolve([]);
  return db
    .select({ id: students.id, name: students.name, studentCode: students.studentCode })
    .from(students)
    .where(and(eq(students.workspaceId, workspaceId), inArray(students.id, studentIds)));
}

export interface AttentionCaseListData {
  cases: AttentionCaseRow[];
  /** Every listed case's Reasons, grouped by `attentionCaseId` (empty array for a case with none). */
  reasonsByCaseId: Map<string, AttentionReasonRow[]>;
  studentsById: Map<string, { id: string; name: string; studentCode: string }>;
}

/**
 * Phase 15C — the whole `GET /attention-cases` page in ONE transaction.
 *
 * The list endpoint used to open a separate RLS transaction for the cases
 * query, another for the batched student names, and then ONE MORE PER CASE
 * for that case's Reasons (the N+1 the DTO builder needed to compute each
 * row's visible priority). This runs the SAME three queries — the exact
 * `listAttentionCasesForWorkspace`, `listStudentNamesByIds`, and a single
 * batched `listAttentionReasonsForCases` — inside one `withRuntimeContext`
 * transaction. The cases query must complete first (its result set decides
 * which student/reason ids to fetch); the reasons + student-name queries are
 * then independent and issued together (postgres.js pipelines them on the
 * one connection). No filtering/scoping logic changes — the caller still
 * applies its Group-Scope reason filter and priority computation exactly as
 * before; this only collapses the transaction count.
 */
export async function loadAttentionCaseList(db: Db, filter: ListAttentionCasesFilter): Promise<AttentionCaseListData> {
  const cases = await listAttentionCasesForWorkspace(db, filter);
  const caseIds = cases.map((c) => c.id);
  const studentIds = [...new Set(cases.map((c) => c.studentId))];

  const [reasons, studentNames] = await Promise.all([
    listAttentionReasonsForCases(db, caseIds),
    listStudentNamesByIds(db, filter.workspaceId, studentIds),
  ]);

  const reasonsByCaseId = new Map<string, AttentionReasonRow[]>();
  for (const reason of reasons) {
    const list = reasonsByCaseId.get(reason.attentionCaseId) ?? [];
    list.push(reason);
    reasonsByCaseId.set(reason.attentionCaseId, list);
  }
  const studentsById = new Map(studentNames.map((s) => [s.id, s]));

  return { cases, reasonsByCaseId, studentsById };
}

export function findScheduledFollowupById(db: Db, id: string): Promise<ScheduledFollowupRow | undefined> {
  return db.select().from(scheduledFollowups).where(eq(scheduledFollowups.id, id)).limit(1).then((r) => r[0]);
}

export interface ListScheduledFollowupsFilter {
  workspaceId: string;
  status?: string;
  /** `undefined` = unrestricted. A (possibly empty) array restricts to follow-ups whose Case has at least one Reason in one of these groups. */
  restrictToGroupIds?: string[];
  limit: number;
  /**
   * Phase 15 fix — was a plain `cursorId` compared with `id >` while the
   * ORDER BY was `due_at`: two uncorrelated orderings, so page 2+ both
   * skipped and repeated rows (a real correctness bug the pagination audit
   * caught, guaranteed to bite once a workspace exceeds one page of
   * follow-ups). Now a proper row-value cursor matching the sort order.
   */
  cursor?: { dueAt: Date; id: string };
}

export async function listScheduledFollowups(
  db: Db,
  filter: ListScheduledFollowupsFilter,
): Promise<ScheduledFollowupRow[]> {
  const conditions = [eq(scheduledFollowups.workspaceId, filter.workspaceId)];
  if (filter.status) conditions.push(eq(scheduledFollowups.status, filter.status));
  if (filter.cursor) {
    conditions.push(
      rawSql`(${scheduledFollowups.dueAt}, ${scheduledFollowups.id}) > (${filter.cursor.dueAt}, ${filter.cursor.id})`,
    );
  }

  if (filter.restrictToGroupIds !== undefined) {
    if (filter.restrictToGroupIds.length === 0) return [];
    const rows = await db
      .selectDistinct({ f: scheduledFollowups })
      .from(scheduledFollowups)
      .innerJoin(attentionReasons, eq(attentionReasons.attentionCaseId, scheduledFollowups.attentionCaseId))
      .where(and(...conditions, inArray(attentionReasons.groupId, filter.restrictToGroupIds)))
      .orderBy(asc(scheduledFollowups.dueAt), asc(scheduledFollowups.id))
      .limit(filter.limit);
    return rows.map((r) => r.f);
  }

  return db
    .select()
    .from(scheduledFollowups)
    .where(and(...conditions))
    .orderBy(asc(scheduledFollowups.dueAt), asc(scheduledFollowups.id))
    .limit(filter.limit);
}

/** The Group a Session belongs to, via its GroupMonth — used to derive the caller's required Group Scope for a `sessionId` passed into `/contact-draft`. */
export async function findGroupIdForSession(db: Db, sessionId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ groupId: groupMonths.groupId })
    .from(sessions)
    .innerJoin(groupMonths, eq(groupMonths.id, sessions.groupMonthId))
    .where(eq(sessions.id, sessionId))
    .limit(1);
  return row?.groupId;
}

export interface ContactDraftSessionContext {
  sessionId: string;
  scheduledAt: Date;
  groupId: string;
  groupName: string;
  groupSubject: string | null;
  attendanceStatus: string | null;
  homeworkStatus: string | null;
  examStatus: string;
  examScore: number | null;
  examMaxScore: number | null;
}

/** Everything `/attention-cases/{id}/contact-draft`'s Arabic template needs for one Session + Student, in one query — group name/subject, and that student's own attendance/homework/exam outcome for that specific session. */
export async function findContactDraftSessionContext(
  db: Db,
  params: { sessionId: string; studentId: string },
): Promise<ContactDraftSessionContext | undefined> {
  const [row] = await db
    .select({
      sessionId: sessions.id,
      scheduledAt: sessions.scheduledAt,
      groupId: groupMonths.groupId,
      groupName: groups.name,
      groupSubject: groups.subject,
      attendanceStatus: sessionRecords.attendanceStatus,
      homeworkStatus: sessionRecords.homeworkStatus,
      examStatus: sessionRecords.examStatus,
      examScore: sessionRecords.examScore,
      examMaxScore: sessionExams.maxScore,
    })
    .from(sessions)
    .innerJoin(groupMonths, eq(groupMonths.id, sessions.groupMonthId))
    .innerJoin(groups, eq(groups.id, groupMonths.groupId))
    .innerJoin(enrollments, and(eq(enrollments.groupMonthId, sessions.groupMonthId), eq(enrollments.studentId, params.studentId)))
    .innerJoin(sessionRecords, and(eq(sessionRecords.sessionId, sessions.id), eq(sessionRecords.enrollmentId, enrollments.id)))
    .leftJoin(sessionExams, eq(sessionExams.sessionId, sessions.id))
    .where(eq(sessions.id, params.sessionId))
    .limit(1);
  if (!row) return undefined;

  return {
    sessionId: row.sessionId,
    scheduledAt: row.scheduledAt,
    groupId: row.groupId,
    groupName: row.groupName,
    groupSubject: row.groupSubject,
    attendanceStatus: row.attendanceStatus,
    homeworkStatus: row.homeworkStatus,
    examStatus: row.examStatus,
    examScore: row.examScore === null ? null : Number(row.examScore),
    examMaxScore: row.examMaxScore === null || row.examMaxScore === undefined ? null : Number(row.examMaxScore),
  };
}

// ---------------------------------------------------------------------------
// Attention Case status transitions (app_runtime — user-driven)
// ---------------------------------------------------------------------------

const TERMINAL_TIMESTAMP_COLUMN: Record<string, "contactedAt" | "monitoringSince" | "closedAt" | undefined> = {
  CONTACTED: "contactedAt",
  MONITORING: "monitoringSince",
  CLOSED: "closedAt",
};

export async function updateAttentionCaseStatusWithVersion(
  db: Db,
  input: { id: string; expectedVersion: number; newStatus: "IN_FOLLOWUP" | "CONTACTED" | "MONITORING" | "CLOSED" },
): Promise<AttentionCaseRow | undefined> {
  const now = new Date();
  const patch: Partial<typeof attentionCases.$inferInsert> = {
    status: input.newStatus,
    updatedAt: now,
    version: input.expectedVersion + 1,
  };
  const tsColumn = TERMINAL_TIMESTAMP_COLUMN[input.newStatus];
  if (tsColumn) patch[tsColumn] = now;

  const [updated] = await db
    .update(attentionCases)
    .set(patch)
    .where(and(eq(attentionCases.id, input.id), eq(attentionCases.version, input.expectedVersion)))
    .returning();
  return updated;
}

// ---------------------------------------------------------------------------
// Contact log + (conditionally) scheduled follow-up — ONE transaction
// ---------------------------------------------------------------------------

export interface InsertContactLogInput {
  workspaceId: string;
  studentId: string;
  guardianId: string;
  attentionCaseId: string | null;
  sessionId: string | null;
  channel: "WHATSAPP_DEEPLINK" | "CALL" | "OTHER";
  draftSnapshot: string;
  outcome: "CONTACTED" | "NO_ANSWER" | "INVALID_NUMBER" | "DEFERRED";
  notes?: string | null;
  followUpAt?: Date | null;
  actorUserId: string;
  actorMembershipId: string | null;
}

export async function insertContactLogTransaction(
  db: Db,
  input: InsertContactLogInput,
): Promise<{ contactLog: ContactLogRow; scheduledFollowup: ScheduledFollowupRow | null }> {
  return db.transaction(async (tx) => {
    const [contactLog] = await tx
      .insert(contactLogs)
      .values({
        workspaceId: input.workspaceId,
        studentId: input.studentId,
        guardianId: input.guardianId,
        attentionCaseId: input.attentionCaseId,
        sessionId: input.sessionId,
        channel: input.channel,
        draftSnapshot: input.draftSnapshot,
        outcome: input.outcome,
        notes: input.notes ?? null,
        followUpAt: input.followUpAt ?? null,
        actorUserId: input.actorUserId,
        actorMembershipId: input.actorMembershipId,
      })
      .returning();
    if (!contactLog) throw new Error("Failed to insert contact_logs row.");

    let scheduledFollowup: ScheduledFollowupRow | null = null;
    if (input.outcome === "DEFERRED") {
      if (!input.attentionCaseId || !input.followUpAt) {
        throw new Error("DEFERRED outcome requires both attentionCaseId and followUpAt.");
      }
      const [inserted] = await tx
        .insert(scheduledFollowups)
        .values({
          workspaceId: input.workspaceId,
          attentionCaseId: input.attentionCaseId,
          studentId: input.studentId,
          dueAt: input.followUpAt,
          status: "PENDING",
          sourceContactLogId: contactLog.id,
        })
        .returning();
      if (!inserted) throw new Error("Failed to insert scheduled_followups row.");
      scheduledFollowup = inserted;
    }

    return { contactLog, scheduledFollowup };
  });
}

export function findMostRecentContactLogForCase(db: Db, attentionCaseId: string): Promise<ContactLogRow | undefined> {
  return db
    .select()
    .from(contactLogs)
    .where(eq(contactLogs.attentionCaseId, attentionCaseId))
    .orderBy(desc(contactLogs.createdAt))
    .limit(1)
    .then((r) => r[0]);
}

export function findMostRecentPendingFollowupForCase(db: Db, attentionCaseId: string): Promise<ScheduledFollowupRow | undefined> {
  return db
    .select()
    .from(scheduledFollowups)
    .where(and(eq(scheduledFollowups.attentionCaseId, attentionCaseId), eq(scheduledFollowups.status, "PENDING")))
    .orderBy(asc(scheduledFollowups.dueAt))
    .limit(1)
    .then((r) => r[0]);
}

// ---------------------------------------------------------------------------
// Scheduled follow-up complete/reschedule
// ---------------------------------------------------------------------------

export async function completeScheduledFollowupWithVersion(
  db: Db,
  input: { id: string; expectedVersion: number },
): Promise<ScheduledFollowupRow | undefined> {
  const now = new Date();
  const [updated] = await db
    .update(scheduledFollowups)
    .set({ status: "DONE", completedAt: now, updatedAt: now, version: input.expectedVersion + 1 })
    .where(
      and(
        eq(scheduledFollowups.id, input.id),
        eq(scheduledFollowups.version, input.expectedVersion),
        eq(scheduledFollowups.status, "PENDING"),
      ),
    )
    .returning();
  return updated;
}

export async function rescheduleScheduledFollowupWithVersion(
  db: Db,
  input: { id: string; expectedVersion: number; newDueAt: Date },
): Promise<ScheduledFollowupRow | undefined> {
  const [updated] = await db
    .update(scheduledFollowups)
    .set({ dueAt: input.newDueAt, updatedAt: new Date(), version: input.expectedVersion + 1 })
    .where(
      and(
        eq(scheduledFollowups.id, input.id),
        eq(scheduledFollowups.version, input.expectedVersion),
        eq(scheduledFollowups.status, "PENDING"),
      ),
    )
    .returning();
  return updated;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AttentionAuditEventInput {
  workspaceId: string;
  actorUserId: string | null;
  actorMembershipId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  beforeJson?: unknown;
  afterJson?: unknown;
  correlationId?: string | null;
}

export async function insertAttentionAuditEvent(db: Db, input: AttentionAuditEventInput): Promise<void> {
  await db.insert(auditEvents).values({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    actorMembershipId: input.actorMembershipId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    beforeJson: input.beforeJson ?? null,
    afterJson: input.afterJson ?? null,
    correlationId: input.correlationId ?? null,
  });
}

// ---------------------------------------------------------------------------
// Rule engine glue — the ONLY function `app_worker` calls to actually
// mutate attention_cases/attention_reasons/attention_evidence. Runs
// entirely inside ONE transaction per completed Session, so a worker crash
// anywhere in this function rolls back atomically — nothing is left
// half-written, and the SAME event will simply be reprocessed by a later
// poll (its own outbox_events row is never marked PROCESSED if this
// throws) with fully idempotent results (Evidence's own UNIQUE constraint
// backstops duplicate inserts; Reason upsert is naturally idempotent; Case
// upsert is naturally idempotent via the partial-unique index).
// ---------------------------------------------------------------------------

export interface EvaluateAttentionRulesResult {
  studentsEvaluated: number;
  casesOpened: number;
  casesUpdated: number;
}

export async function runEvaluateAttentionRulesForSessionTransaction(
  db: Db,
  input: { workspaceId: string; sessionId: string },
): Promise<EvaluateAttentionRulesResult> {
  return db.transaction(async (tx) => {
    const [sessionRow] = await tx
      .select({ id: sessions.id, groupMonthId: sessions.groupMonthId })
      .from(sessions)
      .where(eq(sessions.id, input.sessionId))
      .limit(1);
    if (!sessionRow) return { studentsEvaluated: 0, casesOpened: 0, casesUpdated: 0 };

    const [gm] = await tx
      .select({ groupId: groupMonths.groupId })
      .from(groupMonths)
      .where(eq(groupMonths.id, sessionRow.groupMonthId))
      .limit(1);
    if (!gm) return { studentsEvaluated: 0, casesOpened: 0, casesUpdated: 0 };
    const groupId = gm.groupId;

    // Every student who has a record on THIS session (the one that just completed).
    const studentsOnSession = await tx
      .selectDistinct({ studentId: enrollments.studentId })
      .from(sessionRecords)
      .innerJoin(enrollments, eq(enrollments.id, sessionRecords.enrollmentId))
      .where(eq(sessionRecords.sessionId, input.sessionId));

    let casesOpened = 0;
    let casesUpdated = 0;

    for (const { studentId } of studentsOnSession) {
      // Full session-record history for this student, WITHIN THIS SAME
      // GROUP ONLY (across all of the group's GroupMonths, since a
      // continuing student gets a new Enrollment id each month —
      // Phase 6 Closure Delta — but the Group identity persists). This is
      // exactly what keeps the rule engine's own evaluation group-scoped.
      const historyRows = await tx
        .select({
          sessionId: sessionRecords.sessionId,
          scheduledAt: sessions.scheduledAt,
          attendanceStatus: sessionRecords.attendanceStatus,
          homeworkStatus: sessionRecords.homeworkStatus,
          examStatus: sessionRecords.examStatus,
          examScore: sessionRecords.examScore,
          lowScoreThreshold: sessionExams.lowScoreThreshold,
        })
        .from(sessionRecords)
        .innerJoin(sessions, eq(sessions.id, sessionRecords.sessionId))
        .innerJoin(enrollments, eq(enrollments.id, sessionRecords.enrollmentId))
        .leftJoin(sessionExams, eq(sessionExams.sessionId, sessionRecords.sessionId))
        .where(
          and(
            eq(enrollments.studentId, studentId),
            eq(enrollments.workspaceId, input.workspaceId),
            inArray(
              enrollments.groupMonthId,
              tx.select({ id: groupMonths.id }).from(groupMonths).where(eq(groupMonths.groupId, groupId)),
            ),
          ),
        )
        .orderBy(asc(sessions.scheduledAt));

      const records: RuleEngineSessionRecordInput[] = historyRows.map((r) => ({
        sessionId: r.sessionId,
        scheduledAt: r.scheduledAt,
        attendanceStatus: r.attendanceStatus as RuleEngineSessionRecordInput["attendanceStatus"],
        homeworkStatus: r.homeworkStatus as RuleEngineSessionRecordInput["homeworkStatus"],
        examStatus: r.examStatus as RuleEngineSessionRecordInput["examStatus"],
        examScore: r.examScore === null ? null : Number(r.examScore),
        examLowScoreThreshold: r.lowScoreThreshold === null || r.lowScoreThreshold === undefined ? null : Number(r.lowScoreThreshold),
      }));

      const matches = evaluateRulesForGroup(records);
      if (matches.length === 0) continue;

      const { opened, updated } = await upsertCaseAndReasonsForStudent(tx, {
        workspaceId: input.workspaceId,
        studentId,
        groupId,
        matches,
      });
      if (opened) casesOpened += 1;
      if (updated) casesUpdated += 1;
    }

    return { studentsEvaluated: studentsOnSession.length, casesOpened, casesUpdated };
  });
}

async function upsertCaseAndReasonsForStudent(
  tx: Db,
  params: { workspaceId: string; studentId: string; groupId: string; matches: RuleMatch[] },
): Promise<{ opened: boolean; updated: boolean }> {
  const now = new Date();

  const [existingCase] = await tx
    .select()
    .from(attentionCases)
    .where(
      and(
        eq(attentionCases.workspaceId, params.workspaceId),
        eq(attentionCases.studentId, params.studentId),
        rawSql`${attentionCases.status} <> 'CLOSED'`,
      ),
    )
    .for("update");

  let attentionCase: AttentionCaseRow;
  let opened = false;
  if (!existingCase) {
    const [inserted] = await tx
      .insert(attentionCases)
      .values({
        workspaceId: params.workspaceId,
        studentId: params.studentId,
        status: "NEW",
        priority: "MEDIUM",
        openedAt: now,
        lastQualifiedAt: now,
      })
      .returning();
    if (!inserted) throw new Error("Failed to insert attention_cases row.");
    attentionCase = inserted;
    opened = true;
  } else {
    attentionCase = existingCase;
  }

  let anyGenuinelyNewEvidence = false;

  for (const match of params.matches) {
    const [existingReason] = await tx
      .select()
      .from(attentionReasons)
      .where(
        and(
          eq(attentionReasons.attentionCaseId, attentionCase.id),
          eq(attentionReasons.groupId, params.groupId),
          eq(attentionReasons.ruleKey, match.ruleKey),
        ),
      )
      .for("update");

    let reasonId: string;
    if (!existingReason) {
      const [insertedReason] = await tx
        .insert(attentionReasons)
        .values({
          workspaceId: params.workspaceId,
          attentionCaseId: attentionCase.id,
          groupId: params.groupId,
          ruleKey: match.ruleKey,
          severity: match.severity,
          firstDetectedAt: now,
          lastDetectedAt: now,
          isActive: true,
        })
        .returning();
      if (!insertedReason) throw new Error("Failed to insert attention_reasons row.");
      reasonId = insertedReason.id;
    } else {
      reasonId = existingReason.id;
      await tx
        .update(attentionReasons)
        .set({ lastDetectedAt: now, severity: match.severity, isActive: true, updatedAt: now })
        .where(eq(attentionReasons.id, existingReason.id));
    }

    for (const evidence of match.evidence) {
      const insertedRows = await tx
        .insert(attentionEvidence)
        .values({
          workspaceId: params.workspaceId,
          attentionReasonId: reasonId,
          sourceType: evidence.sourceType,
          sourceId: evidence.sourceId,
          observedAt: evidence.observedAt,
          evidenceSnapshot: evidence.snapshot,
        })
        .onConflictDoNothing({
          target: [attentionEvidence.attentionReasonId, attentionEvidence.sourceType, attentionEvidence.sourceId],
        })
        .returning();
      if (insertedRows.length > 0) anyGenuinelyNewEvidence = true;
    }
  }

  // Priority (V1 approved simple rule):
  // - Each qualifying single rule = MEDIUM; combined.medium = HIGH.
  // - New (genuinely new, not a re-processed duplicate) evidence arriving
  //   while the case is CONTACTED/MONITORING escalates MEDIUM → HIGH.
  // - Never above HIGH; no scoring, no AI.
  const basePriority: "MEDIUM" | "HIGH" = params.matches.some((m) => m.severity === "HIGH") ? "HIGH" : "MEDIUM";
  let nextPriority: "MEDIUM" | "HIGH" = attentionCase.priority === "HIGH" ? "HIGH" : basePriority;
  if (
    anyGenuinelyNewEvidence &&
    (attentionCase.status === "CONTACTED" || attentionCase.status === "MONITORING")
  ) {
    nextPriority = "HIGH";
  }

  const caseChanged = !opened && (nextPriority !== attentionCase.priority || anyGenuinelyNewEvidence);

  if (opened || caseChanged) {
    await tx
      .update(attentionCases)
      .set({
        priority: nextPriority,
        lastQualifiedAt: now,
        updatedAt: now,
        version: attentionCase.version + 1,
      })
      .where(eq(attentionCases.id, attentionCase.id));

    await tx.insert(outboxEvents).values({
      workspaceId: params.workspaceId,
      eventType: opened ? "AttentionCaseOpened" : "AttentionCaseUpdated",
      aggregateType: "AttentionCase",
      aggregateId: attentionCase.id,
      payload: { attentionCaseId: attentionCase.id, studentId: params.studentId, priority: nextPriority },
    });
  }

  return { opened, updated: !opened && caseChanged };
}
