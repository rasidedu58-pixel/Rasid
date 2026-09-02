/**
 * Schema module: subscription_periods — Billing Engine, Phase 4.
 *
 * The IMMUTABLE commercial period ledger. Each row is one paid commercial period
 * fact (a plan/price effective over a time span). Append-only — no row is ever
 * UPDATEd, split, or DELETEd. See migration 0066 for the full model; in short:
 *   • NEW_SUBSCRIPTION / RENEWAL append one full-cycle period.
 *   • UPGRADE appends target-plan rows covering [now, period_end] of each
 *     affected period, winning by higher `seq` — the original still describes
 *     the already-elapsed [start, now] slice.
 *   • `nominal_cycle_*` = the full cycle a (possibly partial) span belongs to,
 *     so a partial upgrade span values exactly as
 *     cycle_price_minor × (period_end-period_start)/(nominal_cycle_end-nominal_cycle_start).
 *
 * Money is `bigint` minor units (ADR-022). Immutable like subscription_payments.
 */
import { sql } from "drizzle-orm";
import { bigint, char, check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { subscriptions } from "./subscriptions";
import { subscriptionPayments } from "./subscription-payments";

export const subscriptionPeriods = pgTable(
  "subscription_periods",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** Monotonic insertion order — the tiebreak for "effective plan at t" (highest seq covering t wins). */
    seq: bigint("seq", { mode: "number" }).notNull().generatedByDefaultAsIdentity(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "restrict" }),
    /** Effective plan for this span (standard plan; CUSTOM reserved, out of Phase-4 scope). */
    planCode: text("plan_code").notNull(),
    billingCycle: text("billing_cycle").notNull(),
    /** The locked FULL-CYCLE list price of `plan_code` (the rate); a span's value = rate × span/nominalCycle. */
    cyclePriceMinor: bigint("cycle_price_minor", { mode: "number" }).notNull(),
    currencyCode: char("currency_code", { length: 3 }).notNull().default("EGP"),
    planPriceVersion: integer("plan_price_version"),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    /** The full cycle this (possibly partial) span belongs to — the valuation denominator. */
    nominalCycleStart: timestamp("nominal_cycle_start", { withTimezone: true }).notNull(),
    nominalCycleEnd: timestamp("nominal_cycle_end", { withTimezone: true }).notNull(),
    sourceAction: text("source_action").notNull(),
    /** Agreed CUSTOM capacity for this period — set only when plan_code = 'CUSTOM' (0069); NULL for standard plans (catalog-driven). */
    customMaxActiveStudents: integer("custom_max_active_students"),
    customMaxTeamMembers: integer("custom_max_team_members"),
    /** The payment that funded this period — nullable only for backfill of pre-ledger paid subscriptions. */
    sourcePaymentId: uuid("source_payment_id").references(() => subscriptionPayments.id, { onDelete: "restrict" }),
    /** Explicit lineage for an UPGRADE row: the period it upgrades from. */
    supersedesPeriodId: uuid("supersedes_period_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    workspaceIdx: index("subscription_periods_workspace_idx").on(table.workspaceId),
    subscriptionSeqIdx: index("subscription_periods_subscription_seq_idx").on(table.subscriptionId, table.seq),
    subscriptionSpanIdx: index("subscription_periods_subscription_span_idx").on(
      table.subscriptionId,
      table.periodStart,
      table.periodEnd,
    ),
    // Worker period-advance: bound the cross-tenant "active at now" scan.
    activeAtIdx: index("subscription_periods_active_at_idx").on(table.periodStart, table.periodEnd),
    planCodeCheck: check(
      "subscription_periods_plan_code_check",
      sql`${table.planCode} IN ('STARTER', 'GROWTH', 'PROFESSIONAL', 'ADVANCED', 'BUSINESS', 'BUSINESS_PLUS', 'CUSTOM')`,
    ),
    billingCycleCheck: check("subscription_periods_billing_cycle_check", sql`${table.billingCycle} IN ('MONTHLY', 'ANNUAL')`),
    sourceActionCheck: check(
      "subscription_periods_source_action_check",
      sql`${table.sourceAction} IN ('NEW_SUBSCRIPTION', 'RENEWAL', 'UPGRADE')`,
    ),
    priceNonNegativeCheck: check("subscription_periods_price_nonnegative_check", sql`${table.cyclePriceMinor} >= 0`),
    spanCheck: check("subscription_periods_span_check", sql`${table.periodEnd} > ${table.periodStart}`),
    nominalSpanCheck: check("subscription_periods_nominal_span_check", sql`${table.nominalCycleEnd} > ${table.nominalCycleStart}`),
    customLimitsCheck: check(
      "subscription_periods_custom_limits_check",
      sql`(${table.planCode} = 'CUSTOM' AND ${table.customMaxActiveStudents} IS NOT NULL AND ${table.customMaxTeamMembers} IS NOT NULL) OR (${table.planCode} <> 'CUSTOM' AND ${table.customMaxActiveStudents} IS NULL AND ${table.customMaxTeamMembers} IS NULL)`,
    ),
    customLimitsPositiveCheck: check(
      "subscription_periods_custom_limits_positive_check",
      sql`(${table.customMaxActiveStudents} IS NULL OR ${table.customMaxActiveStudents} > 3000) AND (${table.customMaxTeamMembers} IS NULL OR ${table.customMaxTeamMembers} >= 0)`,
    ),
  }),
);
