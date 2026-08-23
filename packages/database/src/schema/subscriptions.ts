/**
 * Schema module: subscriptions
 *
 * Phase 8 — implements `subscriptions` (Database Schema §10.1) and
 * `entitlements` (§10.2) exactly as approved, plus one new, minimal,
 * anti-abuse table not in the literal approved column list:
 * `owner_trial_grants`.
 *
 * WHY `owner_trial_grants`: PRD §44.2's own "Anti-abuse boundary" row
 * explicitly anticipates this — "Trial eligibility enforcement is
 * Technical Architecture. Repeated trials via delete/recreate are not
 * guaranteed; implementation may use verified identity/payment/account
 * signals under privacy/legal rules." The approved policy is "one
 * ordinary 14-day trial per WORKSPACE OWNER", not merely per workspace —
 * and this codebase's only workspace-creation path
 * (`createUserWorkspaceMembership`, Phase 1) is keyed to a Supabase auth
 * user id, which cannot by itself prevent the SAME person from getting a
 * second free trial by deleting their account and signing up again with a
 * new auth user id (a different `users.id`). The minimum persistent model
 * that closes this gap without inventing new business rules or touching
 * `users`/`workspaces`: a single lookup table keyed by a SHA-256 hash of
 * the verified, normalized signup email (never the raw email, to minimize
 * PII exposure in a table that is deliberately NOT tenant-scoped — see
 * migration 0037's own comment for why it carries no RLS policy).
 */
import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { users } from "./identity";

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    /** "Paddle عبر adapter في المعمارية المعتمدة" (§10.1) — always 'PADDLE' in V1, but a plain text column per the approved schema (not an enum) so a future provider needs no migration. */
    provider: text("provider").notNull().default("PADDLE"),
    providerCustomerId: text("provider_customer_id"),
    providerSubscriptionId: text("provider_subscription_id"),
    /** §10.1's exact column name/domain — TRIAL/ACTIVE/EXPIRING/EXPIRED/PAYMENT_FAILED/CANCELLED_AT_PERIOD_END. */
    state: text("state").notNull().default("TRIAL"),
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    check(
      "subscriptions_state_check",
      sql`${table.state} IN ('TRIAL', 'ACTIVE', 'EXPIRING', 'EXPIRED', 'PAYMENT_FAILED', 'CANCELLED_AT_PERIOD_END')`,
    ),
    // One commercial record per workspace in V1 — no subscription history/
    // multiple-plan modeling (§10.1 describes a single evolving row,
    // updated in place through its state machine, not an append-only
    // ledger — see migration 0037's own comment on why this table gets
    // UPDATE, unlike `entitlements`).
    unique("subscriptions_workspace_id_unique").on(table.workspaceId),
    // Referenced by the webhook processor to resolve workspace_id from a
    // Paddle event's subscription/customer id — only enforced when non-null
    // (a TRIAL row has neither until checkout completes).
    unique("subscriptions_provider_subscription_id_unique").on(table.providerSubscriptionId),
    // Backs the scheduled expiry-check job's own scan (TRIAL/CANCELLED_AT_PERIOD_END rows whose period_end has passed).
    index("subscriptions_state_period_end_idx").on(table.state, table.periodEnd),
  ],
);

export const entitlements = pgTable(
  "entitlements",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    /** V1 keeps exactly the 4 keys the approved docs name explicitly (§10.2) — CORE_OPERATIONS/CREATE_MONTH/TEAM_MANAGEMENT/REPORT_EXPORT. No HISTORICAL_READ/BILLING_ACCESS keys — historical reads and billing endpoints are gated by ordinary Permission/Scope only, never by Entitlement (explicit correction). */
    capability: text("capability").notNull(),
    state: text("state").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().default(sql`now()`),
    /** NULL = still current. Append-only history (§10.2's own effective_from/to fields) — a new row is inserted for every recompute; the CURRENT value per (workspace, capability) is the row with the latest `effective_from`. Never UPDATEd — see migration 0037. */
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    check(
      "entitlements_capability_check",
      sql`${table.capability} IN ('CORE_OPERATIONS', 'CREATE_MONTH', 'TEAM_MANAGEMENT', 'REPORT_EXPORT')`,
    ),
    check("entitlements_state_check", sql`${table.state} IN ('ALLOWED', 'BLOCKED')`),
    check("entitlements_source_type_check", sql`${table.sourceType} IN ('SUBSCRIPTION', 'TRIAL', 'ADMIN')`),
    index("entitlements_workspace_capability_effective_from_idx").on(
      table.workspaceId,
      table.capability,
      table.effectiveFrom,
    ),
  ],
);

export const ownerTrialGrants = pgTable(
  "owner_trial_grants",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** SHA-256 hex digest of the normalized (lowercased, trimmed) signup email — never the raw email, see module doc comment. */
    emailHash: text("email_hash").notNull(),
    /** Informational only — the user/workspace that FIRST consumed the ordinary trial for this identity. Never used for the eligibility check itself (that's `email_hash` alone), and never updated after insert. */
    firstUserId: uuid("first_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    firstWorkspaceId: uuid("first_workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [unique("owner_trial_grants_email_hash_unique").on(table.emailHash)],
);
