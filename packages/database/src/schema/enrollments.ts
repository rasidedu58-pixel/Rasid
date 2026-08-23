/**
 * Schema module: enrollments
 *
 * Phase 4 — implements `enrollments` (Database Schema §7.1) exactly as
 * approved. Deliberately writes NO `financial_obligations` row anywhere in
 * this phase — that table does not exist until Phase 6 (pre-authorized
 * scoping decision #1).
 *
 * Enforces INT-08 (at most one enrollment row per (student, group_month))
 * via UNIQUE(student_id, group_month_id) — the application service layer
 * implements a clean reactivation path on top of this constraint rather
 * than letting a return-to-the-same-GroupMonth raise a raw unique-violation
 * 500.
 */
import { sql } from "drizzle-orm";
import { bigint, check, date, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { students } from "./students";
import { groupMonths } from "./groups";

export const enrollments = pgTable(
  "enrollments",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    // Denormalized like sessions.workspace_id — indexing/RLS.
    workspaceId: uuid("workspace_id").notNull(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    groupMonthId: uuid("group_month_id")
      .notNull()
      .references(() => groupMonths.id, { onDelete: "restrict" }),
    joinDate: date("join_date").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    feeMethod: text("fee_method").notNull(),
    /** Only meaningful (and only non-null) when fee_method = 'CUSTOM'. */
    customFeeMinor: bigint("custom_fee_minor", { mode: "number" }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endReason: text("end_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    check(
      "enrollments_status_check",
      sql`${table.status} IN ('PENDING', 'ACTIVE', 'STOPPED', 'WITHDRAWN', 'TRANSFERRED')`,
    ),
    check(
      "enrollments_fee_method_check",
      sql`${table.feeMethod} IN ('FULL_MONTH', 'CUSTOM', 'REMAINING_SESSIONS')`,
    ),
    check(
      "enrollments_custom_fee_minor_check",
      sql`(${table.feeMethod} = 'CUSTOM') = (${table.customFeeMinor} IS NOT NULL)`,
    ),
    // INT-08 — at most one enrollment row per (student, group_month).
    unique("enrollments_student_group_month_unique").on(table.studentId, table.groupMonthId),
    index("enrollments_workspace_group_month_status_idx").on(
      table.workspaceId,
      table.groupMonthId,
      table.status,
    ),
  ],
);
