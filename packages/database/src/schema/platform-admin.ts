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
    // Platform-Operations RBAC role (migration 0056). One of PLATFORM_OWNER /
    // OPERATIONS_ADMIN / SUPPORT_AGENT — decides which platform WRITE actions
    // this already-allowlisted staff member may take. A CHECK constraint in the
    // migration is the source of truth for the allowed values.
    role: text("role").notNull().default("SUPPORT_AGENT"),
    // Reversible access hold (migration 0060). ACTIVE / DISABLED. A DISABLED
    // staff member keeps their row + role but PlatformAdminGuard treats them as
    // no-access — real backend enforcement, not just a UI badge.
    status: text("status").notNull().default("ACTIVE"),
    // Who invited this staff member (set on invite acceptance; null for the
    // out-of-band-seeded founder). set null so the row survives their removal.
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, { onDelete: "set null" }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    note: text("note"),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [unique("platform_admins_user_id_unique").on(table.userId)],
);

/**
 * Platform Staff invitations (migration 0060) — a secure, expiring, single-use
 * link by which a new person becomes a `platform_admins` row. The admin never
 * sets a password. Same token security as `workspace_invitations`: only the
 * SHA-256 hex digest is stored (`token_hash`), never the raw token. Platform
 * table (no tenant RLS); `app_platform_admin` manages it. No privilege is
 * granted until the invite is accepted (acceptance INSERTs the platform_admins
 * row atomically). `email` binds the invite to the intended recipient.
 */
export const platformStaffInvitations = pgTable(
  "platform_staff_invitations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull(),
    role: text("role").notNull(),
    status: text("status").notNull().default("PENDING"),
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, { onDelete: "set null" }),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [unique("platform_staff_invitations_token_hash_unique").on(table.tokenHash)],
);

/**
 * Customer onboarding invitations (migration 0060) — the platform records a
 * customer's identity and mints a secure onboarding link. The customer opens
 * it and authenticates through the normal Supabase Auth flow; the existing
 * lazy provisioning creates their own workspace + trial. This invite is a
 * tracked, single-use, expiring record claimed atomically on first arrival —
 * it never provisions anything itself. Platform table; `app_platform_admin`
 * manages it.
 */
export const platformCustomerInvitations = pgTable(
  "platform_customer_invitations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    fullName: text("full_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    tokenHash: text("token_hash").notNull(),
    status: text("status").notNull().default("PENDING"),
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, { onDelete: "set null" }),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id, { onDelete: "set null" }),
    acceptedWorkspaceId: uuid("accepted_workspace_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [unique("platform_customer_invitations_token_hash_unique").on(table.tokenHash)],
);

/**
 * Workspace feature overrides (migration 0060) — a per-workspace ENABLE/DISABLE
 * exception layered on top of the GLOBAL `feature_flags` availability. Only a
 * feature key that exists in the code catalog may be targeted (validated in the
 * service). NOT a billing entitlement and NOT an RBAC bypass. Append-only
 * history: an override is revoked (revoked_at), never hard-deleted; the active
 * one per (workspace, feature) is revoked_at IS NULL AND (expires_at IS NULL OR
 * expires_at > now()). Tenant reads its own (app_runtime SELECT) so the runtime
 * feature gate can honor it; `app_platform_admin` manages it.
 */
export const workspaceFeatureOverrides = pgTable("workspace_feature_overrides", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  workspaceId: uuid("workspace_id").notNull(),
  featureKey: text("feature_key").notNull(),
  state: text("state").notNull(),
  reason: text("reason").notNull(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedByUserId: uuid("revoked_by_user_id").references(() => users.id, { onDelete: "set null" }),
});

/**
 * Unit 1 — Customer Communication. A company→customer contact record logged
 * by Rasid staff against a target workspace. A PLATFORM table (not tenant
 * data): only `app_platform_admin` touches it; no `workspace_id`-keyed RLS
 * tenant policy applies. `created_by_user_id` is the staff member (nullable /
 * set-null so the log survives an account removal).
 */
export const platformContactLogs = pgTable("platform_contact_logs", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  workspaceId: uuid("workspace_id").notNull(),
  channel: text("channel").notNull(),
  direction: text("direction").notNull().default("OUTBOUND"),
  summary: text("summary").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().default(sql`now()`),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/**
 * Unit 1 — Follow-ups. A task Rasid staff queue against a customer workspace
 * (call back, chase payment, check activation). PLATFORM table, same access
 * model as `platform_contact_logs`.
 */
export const platformFollowUps = pgTable("platform_follow_ups", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  workspaceId: uuid("workspace_id").notNull(),
  title: text("title").notNull(),
  note: text("note"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  status: text("status").notNull().default("PENDING"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  assignedToUserId: uuid("assigned_to_user_id").references(() => users.id, { onDelete: "set null" }),
  resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/**
 * Operating-Month Overrides — a per-workspace OPERATIONAL exception set by
 * Rasid staff (Platform Ops), read by the tenant month-prepare flow. Distinct
 * from feature entitlements (never grants CREATE_MONTH / extends a
 * subscription). `type` = EARLY_PREP_ALLOWED (prepare the next month's DRAFT
 * before the natural window) or PREP_BLOCKED (block preparing any new month).
 * Append-only history: an override is never hard-deleted; a new one of the same
 * type revokes the prior. "Active" = revoked_at IS NULL AND (expires_at IS NULL
 * OR expires_at > now()).
 */
export const platformOperatingMonthOverrides = pgTable("platform_operating_month_overrides", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  workspaceId: uuid("workspace_id").notNull(),
  type: text("type").notNull(),
  reason: text("reason").notNull(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedByUserId: uuid("revoked_by_user_id").references(() => users.id, { onDelete: "set null" }),
});

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
