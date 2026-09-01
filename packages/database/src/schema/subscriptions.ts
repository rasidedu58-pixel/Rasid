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
import { bigint, boolean, char, check, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    // ── Commercial plan + price snapshot (Billing Engine, Phase 1) ──────────
    // The plan the workspace is on. NULL while TRIAL / never-converted; a
    // standard code or 'CUSTOM' once paid. Limits/prices for standard codes are
    // owned by the Plan Catalog (packages/contracts/billing-catalog.ts).
    planCode: text("plan_code"),
    billingCycle: text("billing_cycle"),
    // Per-subscription capacity — used ONLY when planCode = 'CUSTOM'.
    customMaxActiveStudents: integer("custom_max_active_students"),
    customMaxTeamMembers: integer("custom_max_team_members"),
    // The COMMERCIAL PRICE SNAPSHOT actually agreed with THIS customer — integer
    // minor units (ADR-022, never a float). Deliberately NOT derived from the
    // catalog at read time: a future catalog price change must never silently
    // re-price an existing customer on deploy. `planPriceVersion` records which
    // catalog price generation was locked (NULL for a hand-priced CUSTOM deal).
    currentPriceMinor: bigint("current_price_minor", { mode: "number" }),
    priceCurrencyCode: char("price_currency_code", { length: 3 }),
    planPriceVersion: integer("plan_price_version"),
    // ── Scheduled downgrade (Billing Engine, Phase 4) — a FUTURE-renewal target
    // only; NEVER the current plan. Presence of pendingPlanCode = one scheduled
    // downgrade exists. All-or-nothing (see check). Cleared when a renewal
    // consumes it or the owner cancels it (migration 0066).
    pendingPlanCode: text("pending_plan_code"),
    pendingBillingCycle: text("pending_billing_cycle"),
    pendingChangeRequestedAt: timestamp("pending_change_requested_at", { withTimezone: true }),
    pendingChangeRequestedBy: uuid("pending_change_requested_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    check(
      "subscriptions_state_check",
      sql`${table.state} IN ('TRIAL', 'ACTIVE', 'EXPIRING', 'EXPIRED', 'PAYMENT_FAILED', 'CANCELLED_AT_PERIOD_END')`,
    ),
    // Commercial-plan integrity (Phase 1). Mirrors migration 0062 exactly.
    check(
      "subscriptions_plan_code_check",
      sql`${table.planCode} IS NULL OR ${table.planCode} IN ('STARTER', 'GROWTH', 'PROFESSIONAL', 'ADVANCED', 'BUSINESS', 'BUSINESS_PLUS', 'CUSTOM')`,
    ),
    check("subscriptions_billing_cycle_check", sql`${table.billingCycle} IS NULL OR ${table.billingCycle} IN ('MONTHLY', 'ANNUAL')`),
    // CUSTOM requires both custom limits; every non-CUSTOM plan (and NULL) must carry neither.
    check(
      "subscriptions_custom_requires_custom_limits_check",
      sql`${table.planCode} IS DISTINCT FROM 'CUSTOM' OR (${table.customMaxActiveStudents} IS NOT NULL AND ${table.customMaxTeamMembers} IS NOT NULL)`,
    ),
    check(
      "subscriptions_noncustom_no_custom_limits_check",
      sql`COALESCE(${table.planCode}, '') = 'CUSTOM' OR (${table.customMaxActiveStudents} IS NULL AND ${table.customMaxTeamMembers} IS NULL)`,
    ),
    check(
      "subscriptions_custom_limits_positive_check",
      sql`(${table.customMaxActiveStudents} IS NULL OR ${table.customMaxActiveStudents} > 0) AND (${table.customMaxTeamMembers} IS NULL OR ${table.customMaxTeamMembers} >= 0)`,
    ),
    check("subscriptions_price_nonnegative_check", sql`${table.currentPriceMinor} IS NULL OR ${table.currentPriceMinor} >= 0`),
    // Scheduled-downgrade pending state (Phase 4, migration 0066).
    check(
      "subscriptions_pending_plan_code_check",
      sql`${table.pendingPlanCode} IS NULL OR ${table.pendingPlanCode} IN ('STARTER', 'GROWTH', 'PROFESSIONAL', 'ADVANCED', 'BUSINESS', 'BUSINESS_PLUS')`,
    ),
    check("subscriptions_pending_billing_cycle_check", sql`${table.pendingBillingCycle} IS NULL OR ${table.pendingBillingCycle} IN ('MONTHLY', 'ANNUAL')`),
    check(
      "subscriptions_pending_all_or_none_check",
      sql`(${table.pendingPlanCode} IS NULL AND ${table.pendingBillingCycle} IS NULL AND ${table.pendingChangeRequestedAt} IS NULL AND ${table.pendingChangeRequestedBy} IS NULL) OR (${table.pendingPlanCode} IS NOT NULL AND ${table.pendingBillingCycle} IS NOT NULL AND ${table.pendingChangeRequestedAt} IS NOT NULL AND ${table.pendingChangeRequestedBy} IS NOT NULL)`,
    ),
    // A price implies a plan + cycle + currency (but NOT a version — a CUSTOM price is hand-set, planPriceVersion NULL).
    check(
      "subscriptions_price_implies_plan_check",
      sql`${table.currentPriceMinor} IS NULL OR (${table.planCode} IS NOT NULL AND ${table.billingCycle} IS NOT NULL AND ${table.priceCurrencyCode} IS NOT NULL)`,
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
    /**
     * NULL = still current (the open row). Phase 8 Closure Delta #2 —
     * append+CLOSE, not pure append: every recompute closes the
     * PREVIOUSLY-open row (`effective_to = transition_time`) in the same
     * transaction that inserts the new open row
     * (`effective_from = transition_time`, `effective_to = NULL`). History
     * is otherwise immutable — the only ever UPDATE is this one-time close,
     * restricted at the grant level to exactly this column (+ `updated_at`)
     * — see migration 0040. "Current" is looked up via
     * `effective_to IS NULL`, never "latest effective_from wins".
     */
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
    // Closure Delta #2: at most ONE open row per (workspace, capability) at
    // the DB level — the append+close transaction's own correctness backed
    // by a constraint, not just application discipline. Migration 0040.
    uniqueIndex("entitlements_workspace_capability_open_unique")
      .on(table.workspaceId, table.capability)
      .where(sql`${table.effectiveTo} IS NULL`),
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
    /**
     * The user that FIRST consumed the ordinary trial for this identity.
     * Phase 8 Closure Delta #1: also carries its own `UNIQUE` constraint
     * (alongside `email_hash`'s) — the approved rule is "one ordinary trial
     * per WORKSPACE OWNER", the stable identity, not merely the verified
     * email used at the moment of signup. Both constraints together mean an
     * insert is rejected if EITHER the same user OR the same verified email
     * has already consumed a trial — see `subscriptions.repository.ts`'s
     * plain (untargeted) `ON CONFLICT DO NOTHING`, which catches a
     * violation on either column.
     */
    firstUserId: uuid("first_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    firstWorkspaceId: uuid("first_workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    unique("owner_trial_grants_email_hash_unique").on(table.emailHash),
    unique("owner_trial_grants_first_user_id_unique").on(table.firstUserId),
  ],
);
