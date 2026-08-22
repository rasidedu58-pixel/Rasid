/**
 * Schema module: audit
 *
 * Pulled forward into Phase 2 (originally slot 0015 in the illustrative
 * migration plan) because Phase 2's Definition of Done requires an
 * audit_events row for every permission grant/revoke/membership-disable
 * action. Table shape is unchanged from Database Schema v1.0 Approved
 * §11.1 — only its migration timing differs.
 *
 * Append-only: no UPDATE/DELETE from the normal application DB role (see
 * the Phase 2 RLS/permissions migration, which revokes those privileges
 * for the app role on this table).
 */
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity";
import { memberships } from "./permissions";
import { workspaces } from "./workspaces";

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    /** System actor may be nullable. */
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorMembershipId: uuid("actor_membership_id").references(() => memberships.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    /** Logical reference — no FK, to preserve history across entity deletes. */
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    beforeJson: jsonb("before_json"),
    afterJson: jsonb("after_json"),
    reason: text("reason"),
    correlationId: text("correlation_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    index("audit_events_workspace_created_idx").on(table.workspaceId, table.createdAt),
    index("audit_events_workspace_entity_idx").on(
      table.workspaceId,
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
  ],
);
