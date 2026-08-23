/**
 * Schema module: guardians
 *
 * Phase 4 — implements `guardians` (Database Schema §6.2) and
 * `student_guardians` (§6.3) exactly as approved.
 *
 * `guardians.normalized_phone` deliberately has NO uniqueness constraint —
 * V1 shows possible matches to the teacher (`POST /students/match-preview`)
 * and never auto-merges guardians sharing a phone number (Phase 4
 * pre-authorized decision #6/prohibition list).
 *
 * `student_guardians` enforces INT-03 (at most one primary guardian per
 * student) via a partial UNIQUE index on `student_id` WHERE
 * `is_primary = true`.
 */
import { sql } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp, unique, uniqueIndex, uuid, integer } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { students } from "./students";

export const guardians = pgTable(
  "guardians",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    name: text("name"),
    /** Raw display/entry value as provided by the teacher. */
    phone: text("phone").notNull(),
    /** Normalized (digits-only, consistent country-code form) for search/matching — see arabic-normalize.ts's phone helper. */
    normalizedPhone: text("normalized_phone").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    index("guardians_workspace_normalized_phone_idx").on(table.workspaceId, table.normalizedPhone),
  ],
);

export const studentGuardians = pgTable(
  "student_guardians",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    // Denormalized like sessions.workspace_id — indexing/RLS.
    workspaceId: uuid("workspace_id").notNull(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    guardianId: uuid("guardian_id")
      .notNull()
      .references(() => guardians.id, { onDelete: "restrict" }),
    relationship: text("relationship"),
    isPrimary: boolean("is_primary").notNull().default(false),
    academicContactEnabled: boolean("academic_contact_enabled").notNull().default(true),
    financialContactEnabled: boolean("financial_contact_enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    unique("student_guardians_student_guardian_unique").on(table.studentId, table.guardianId),
    // INT-03 — at most one primary guardian per student.
    uniqueIndex("student_guardians_student_primary_unique")
      .on(table.studentId)
      .where(sql`${table.isPrimary} = true`),
    index("student_guardians_guardian_idx").on(table.guardianId),
  ],
);
