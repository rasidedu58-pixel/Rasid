/**
 * Schema module: permissions
 *
 * Phase 1 implemented `memberships` (Database Schema §4.3).
 * Phase 2 adds `permission_grants` (§4.4) and `permission_group_scopes`
 * (§4.5) exactly as approved.
 */
import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
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
    /** Functional label only — not the sole source of authority (see permission_grants). */
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

/**
 * permission_grants — Database Schema §4.4.
 *
 * `workspace_id` is intentionally denormalized (also derivable via
 * membership_id -> memberships.workspace_id) for indexing/RLS protection
 * per the approved schema note. Revocation is soft (`revoked_at`) — grant
 * rows are never hard-deleted, preserving Actor/audit history.
 */
export const permissionGrants = pgTable(
  "permission_grants",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "restrict" }),
    permissionKey: text("permission_key").notNull(),
    scopeType: text("scope_type").notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "permission_grants_scope_type_check",
      sql`${table.scopeType} IN ('ALL_GROUPS', 'SELECTED_GROUPS')`,
    ),
    // Partial UNIQUE(membership_id, permission_key) WHERE revoked_at IS NULL
    // — a membership can hold at most one *active* grant per permission key.
    uniqueIndex("permission_grants_membership_permission_active_unique")
      .on(table.membershipId, table.permissionKey)
      .where(sql`${table.revokedAt} IS NULL`),
    index("permission_grants_workspace_idx").on(table.workspaceId),
    index("permission_grants_membership_idx").on(table.membershipId),
  ],
);

/**
 * permission_group_scopes — Database Schema §4.5.
 *
 * IMPORTANT — deliberate, user-authorized scoping decision (Phase 2 spec):
 * `group_id` has NO foreign key constraint here. The real `groups` table
 * does not exist yet — it is built in Phase 3. Adding a FK now is
 * impossible (the referenced table doesn't exist) and the approved schema
 * table itself only requires `group_id uuid NOT NULL` at this layer; the
 * referential guarantee is provided by the `GroupOwnershipPort` application
 * check at grant time (see apps/api Phase 2 authorization module), not by
 * the database. Phase 3 will add `REFERENCES groups(id)` via its own
 * migration once the `groups` table exists — this file/migration must NOT
 * be edited retroactively; Phase 3 adds a new ALTER TABLE migration.
 */
export const permissionGroupScopes = pgTable(
  "permission_group_scopes",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    permissionGrantId: uuid("permission_grant_id")
      .notNull()
      .references(() => permissionGrants.id, { onDelete: "cascade" }),
    // No FK to `groups` — see module comment above (Phase 3 adds it).
    groupId: uuid("group_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    unique("permission_group_scopes_grant_group_unique").on(
      table.permissionGrantId,
      table.groupId,
    ),
  ],
);
