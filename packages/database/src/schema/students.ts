/**
 * Schema module: students
 *
 * Phase 4 — implements `students` (Database Schema §6.1) exactly as
 * approved.
 *
 * Deliberately has NO `guardian_phone`, `group_id`, or `month_id` column — a
 * Student's guardians live in `student_guardians`/`guardians`, and a
 * Student's group membership over time lives entirely in `enrollments`. The
 * GIN trigram index on `search_name_normalized` (requires `pg_trgm`, created
 * in migration 0015) backs Arabic fuzzy name search (API Contract §13).
 */
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, unique, uuid, integer } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

export const students = pgTable(
  "students",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    /** Stable, human-facing, workspace-scoped code — see students.repository.ts's generateStudentCode. */
    studentCode: text("student_code").notNull(),
    name: text("name").notNull(),
    /** Normalized (Arabic-aware) name, re-derived on every name write — see arabic-normalize.ts. */
    searchNameNormalized: text("search_name_normalized").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    check("students_status_check", sql`${table.status} IN ('ACTIVE', 'ARCHIVED')`),
    unique("students_workspace_student_code_unique").on(table.workspaceId, table.studentCode),
    index("students_workspace_status_idx").on(table.workspaceId, table.status),
    // Phase 15 — declared here so drizzle-kit never generates a DROP for
    // the migration-created trigram index (schema/migration drift found by
    // the index audit; the index itself has existed since 0015).
    index("students_search_name_trgm_idx").using("gin", table.searchNameNormalized.op("gin_trgm_ops")),
    // Phase 15 — serves the directory page's (workspace_id, id) cursor
    // walk; created in migration 0049.
    index("students_workspace_id_id_idx").on(table.workspaceId, table.id),
  ],
);
