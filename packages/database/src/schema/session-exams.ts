/**
 * Schema module: session_exams
 *
 * Phase 5 — implements `session_exams` (Database Schema §7.2) exactly as
 * approved. One optional exam per Session in V1 (`UNIQUE(session_id)`).
 * `absent_from_exam` is a distinct `session_records.exam_status` value, not
 * a numeric zero — this table only carries the exam's own configuration
 * (name/max_score/low_score_threshold), never a per-student score.
 */
import { sql } from "drizzle-orm";
import { check, numeric, pgTable, text, timestamp, unique, uuid, integer } from "drizzle-orm/pg-core";
import { sessions } from "./sessions";

export const sessionExams = pgTable(
  "session_exams",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    // Denormalized like sessions.workspace_id — indexing/RLS.
    workspaceId: uuid("workspace_id").notNull(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "restrict" }),
    name: text("name"),
    // drizzle-orm's `numeric` type maps to TS `string` (avoids silent
    // float-precision loss on the driver boundary — same reasoning as this
    // codebase's money columns, even though exam scores aren't money);
    // `session-mode.repository.ts` converts to/from `number` at its own
    // boundary via `Number(...)`/`.toString()`.
    maxScore: numeric("max_score", { precision: 8, scale: 2 }).notNull(),
    /** NULL = low-score rule disabled until explicitly configured (PRD §34). */
    lowScoreThreshold: numeric("low_score_threshold", { precision: 8, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    // One exam per Session in V1.
    unique("session_exams_session_unique").on(table.sessionId),
    check("session_exams_max_score_check", sql`${table.maxScore} > 0`),
    check(
      "session_exams_low_score_threshold_check",
      sql`${table.lowScoreThreshold} IS NULL OR (${table.lowScoreThreshold} >= 0 AND ${table.lowScoreThreshold} <= ${table.maxScore})`,
    ),
  ],
);
