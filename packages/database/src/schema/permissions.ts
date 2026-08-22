/**
 * Schema module: permissions
 *
 * Phase 1 — implements ONLY the `memberships` table per Database Schema
 * v1.0 Approved §4.3 (owner membership use case for this phase).
 *
 * `permission_grants` (§4.4) and `permission_group_scopes` (§4.5) remain
 * RESERVED for Phase 2 (the full permission engine) and are intentionally
 * NOT defined here — do not add them in this phase.
 */
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity";
import { workspaces } from "./workspaces";

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Functional label only — not the sole source of authority (see permission_grants, Phase 2). */
    roleLabel: text("role_label").notNull(),
    status: text("status").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    unique("memberships_workspace_user_unique").on(table.workspaceId, table.userId),
    index("memberships_user_status_idx").on(table.userId, table.status),
    check("memberships_status_check", sql`${table.status} IN ('INVITED', 'ACTIVE', 'DISABLED')`),
  ],
);

// permission_grants and permission_group_scopes (Database Schema §4.4/§4.5)
// remain reserved for Phase 2 — do not implement here.
