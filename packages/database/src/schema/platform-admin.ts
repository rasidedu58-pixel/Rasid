/**
 * Schema module: platform-admin
 *
 * Phase 12 — Rasid Platform Admin. A platform-level privileged
 * administrator is a COMPLETELY SEPARATE concept from a workspace Owner or
 * any tenant membership (PRD instruction, explicit): no workspace
 * membership row, role label, or permission grant can ever confer this.
 *
 * `platform_admins`: a small allowlist table, following the EXACT same
 * pattern as `owner_trial_grants` (subscriptions.ts) — a narrow,
 * NOT-tenant-scoped table with NO RLS policy at all (RLS is a tenant-
 * isolation mechanism; this table isn't tenant data, and a workspace_id-
 * keyed policy could never express "is this identity a platform admin
 * globally"). Access is instead controlled purely by GRANT: only
 * `app_runtime` gets SELECT (for `PlatformAdminGuard`'s own membership
 * check), and no INSERT/UPDATE/DELETE grant exists for any application
 * role in V1 — granting/revoking platform-admin status is a deliberate,
 * out-of-band operation (documented in packages/database/README, same
 * convention as the `app_runtime`/`app_worker` role passwords), never a
 * self-service or even Owner-reachable action.
 *
 * `platform_audit_events`: append-only audit trail for platform-admin
 * mutations, mirroring `audit_events`' shape but WITHOUT its `workspace_id
 * NOT NULL` constraint — a platform-level action may or may not target one
 * specific workspace (e.g. "list all users" has no single target), and
 * retrofitting the tenant-scoped `audit_events` table to accept a nullable
 * workspace_id would weaken every other consumer's FK-restrict tenant-
 * isolation guarantee. `target_workspace_id` here is a plain nullable
 * column with no FK `restrict` (a platform admin must be able to audit an
 * action even if the referenced workspace is later hard-deleted — which
 * this product otherwise never does, but this table's own integrity
 * should not depend on that).
 */
import { sql } from "drizzle-orm";
import { jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity";

export const platformAdmins = pgTable(
  "platform_admins",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    note: text("note"),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [unique("platform_admins_user_id_unique").on(table.userId)],
);

export const platformAuditEvents = pgTable("platform_audit_events", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: uuid("target_id"),
  targetWorkspaceId: uuid("target_workspace_id"),
  beforeJson: jsonb("before_json"),
  afterJson: jsonb("after_json"),
  reason: text("reason"),
  correlationId: text("correlation_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});
