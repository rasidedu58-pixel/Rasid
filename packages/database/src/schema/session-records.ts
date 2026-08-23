/**
 * Schema module: session_records
 *
 * Phase 5 — implements `session_records` (Database Schema §7.3) exactly as
 * approved. One row per (session, enrollment) pair; `NULL` on
 * `attendance_status`/`homework_status` means "missing" (draft, not yet
 * recorded) — distinct from a resolved value like `NO_HOMEWORK` or
 * `ABSENT_FROM_EXAM`, which are NOT missing.
 *
 * Cross-group integrity (`session_id`/`enrollment_id` must both belong to
 * the SAME `group_month_id`) is enforced by a pair of Composite Foreign
 * Keys added in the hand-written migration (`sessions(id, group_month_id)`
 * / `enrollments(id, group_month_id)`, per Database Schema §7.3's own
 * prescription) — not expressible via drizzle-kit generate, so — like every
 * other hand-written constraint in this package (RLS, composite/cross-
 * workspace guards) — the FK itself lives only in migration SQL; these
 * columns are declared as plain `uuid` here, matching the existing
 * convention (e.g. `enrollments.groupMonthId` in Phase 4).
 */
import { sql } from "drizzle-orm";
import { check, numeric, pgTable, text, timestamp, unique, uuid, integer } from "drizzle-orm/pg-core";
import { users } from "./identity";

export const sessionRecords = pgTable(
  "session_records",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id").notNull(),
    /** Denormalized anchor — also the shared column of both composite FKs. */
    groupMonthId: uuid("group_month_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    enrollmentId: uuid("enrollment_id").notNull(),
    /** NULL = missing (draft). */
    attendanceStatus: text("attendance_status"),
    /** NULL = missing (draft). NO_HOMEWORK is a resolved state, not missing. */
    homeworkStatus: text("homework_status"),
    /** Defaults to NO_EXAM until a session_exams row exists and is scored. */
    examStatus: text("exam_status").notNull().default("NO_EXAM"),
    /**
     * Only non-null when exam_status = SCORED. Never a stand-in for
     * ABSENT_FROM_EXAM. TS type is `string` (drizzle-orm numeric default;
     * see session-exams.ts's same note) — converted at the repository
     * boundary.
     */
    examScore: numeric("exam_score", { precision: 8, scale: 2 }),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    unique("session_records_session_enrollment_unique").on(table.sessionId, table.enrollmentId),
    check(
      "session_records_attendance_status_check",
      sql`${table.attendanceStatus} IS NULL OR ${table.attendanceStatus} IN ('PRESENT', 'ABSENT', 'LATE')`,
    ),
    check(
      "session_records_homework_status_check",
      sql`${table.homeworkStatus} IS NULL OR ${table.homeworkStatus} IN ('DONE', 'PARTIAL', 'NOT_DONE', 'NO_HOMEWORK')`,
    ),
    check(
      "session_records_exam_status_check",
      sql`${table.examStatus} IN ('NO_EXAM', 'SCORED', 'ABSENT_FROM_EXAM')`,
    ),
    check(
      "session_records_exam_score_check",
      sql`(${table.examStatus} = 'SCORED') = (${table.examScore} IS NOT NULL)`,
    ),
    check("session_records_exam_score_nonnegative_check", sql`${table.examScore} IS NULL OR ${table.examScore} >= 0`),
  ],
);
