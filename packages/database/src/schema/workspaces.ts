/**
 * Schema module: workspaces
 *
 * Phase 1 — implements the `workspaces` table per Database Schema v1.0
 * Approved §4.2 exactly, including the CHECK constraint tying
 * `due_date_policy` to `unified_due_day`.
 */
import { sql } from "drizzle-orm";
import { check, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity";

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    workspaceType: text("workspace_type").notNull().default("TEACHER"),
    locale: text("locale").notNull().default("ar-EG"),
    timezone: text("timezone").notNull().default("Africa/Cairo"),
    dueDatePolicy: text("due_date_policy").notNull().default("PER_GROUP"),
    /** Only present (1..28) when due_date_policy = UNIFIED. */
    unifiedDueDay: smallint("unified_due_day"),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    check("workspaces_type_check", sql`${table.workspaceType} IN ('TEACHER', 'CENTER')`),
    check("workspaces_status_check", sql`${table.status} IN ('ACTIVE', 'ARCHIVED')`),
    check(
      "workspaces_due_date_policy_check",
      sql`(${table.dueDatePolicy} = 'UNIFIED' AND ${table.unifiedDueDay} BETWEEN 1 AND 28)
        OR (${table.dueDatePolicy} = 'PER_GROUP' AND ${table.unifiedDueDay} IS NULL)`,
    ),
  ],
);
