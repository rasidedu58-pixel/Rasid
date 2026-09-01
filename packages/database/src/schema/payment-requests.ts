/**
 * Schema module: payment_requests — Billing Engine, Phase 3.
 *
 * The two-phase commercial object: a customer's intent to pay for a plan,
 * created BEFORE any money moves, resolved later by a platform admin who
 * verifies the manual payment (InstaPay / Vodafone Cash) via a WhatsApp proof.
 * Money is integer minor units (ADR-022). No screenshot/attachment ever lands
 * here — correlation is purely via `human_code`.
 *
 * Anti-spam: a PARTIAL UNIQUE index allows AT MOST ONE PENDING request per
 * workspace (migration 0063) — creating a new one deterministically cancels any
 * existing PENDING first (see `payment-requests.repository.ts`).
 */
import { sql } from "drizzle-orm";
import { bigint, char, check, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { users } from "./identity";

export const paymentRequests = pgTable(
  "payment_requests",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Short human-readable correlation code (e.g. RSD-A7K29) — for human matching against the WhatsApp message, NEVER an authorization token. UNIQUE. */
    humanCode: text("human_code").notNull(),
    actionType: text("action_type").notNull(),
    /** A standard plan code (V1 flow is NEW_SUBSCRIPTION / RENEWAL for standard plans only). */
    targetPlanCode: text("target_plan_code").notNull(),
    billingCycle: text("billing_cycle").notNull(),
    /** SERVER-computed from the plan catalog — a client-supplied amount is never trusted. */
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currencyCode: char("currency_code", { length: 3 }).notNull().default("EGP"),
    paymentMethod: text("payment_method").notNull(),
    status: text("status").notNull().default("PENDING"),
    /** The `subscriptions.version` this request was quoted against — a confirm is refused if the subscription changed meanwhile (stale-quote guard). */
    boundSubscriptionVersion: integer("bound_subscription_version").notNull(),
    /** Frozen quote (plan, cycle, catalog price, plan_price_version, currency) — the immutable commercial terms this request is bound to. */
    quoteSnapshotJson: jsonb("quote_snapshot_json").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    rejectReason: text("reject_reason"),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id, { onDelete: "restrict" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    unique("payment_requests_human_code_unique").on(table.humanCode),
    check("payment_requests_action_type_check", sql`${table.actionType} IN ('NEW_SUBSCRIPTION', 'RENEWAL', 'UPGRADE')`),
    check("payment_requests_billing_cycle_check", sql`${table.billingCycle} IN ('MONTHLY', 'ANNUAL')`),
    check("payment_requests_method_check", sql`${table.paymentMethod} IN ('INSTAPAY', 'VODAFONE_CASH')`),
    check("payment_requests_status_check", sql`${table.status} IN ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'EXPIRED')`),
    check("payment_requests_amount_positive_check", sql`${table.amountMinor} > 0`),
    // A REJECTED request must carry a reason (mandatory reject reason).
    check("payment_requests_reject_reason_check", sql`${table.status} <> 'REJECTED' OR ${table.rejectReason} IS NOT NULL`),
    // A resolved request (CONFIRMED/REJECTED) records who + when.
    check("payment_requests_resolution_check", sql`${table.status} IN ('PENDING', 'CANCELLED', 'EXPIRED') OR (${table.resolvedByUserId} IS NOT NULL AND ${table.resolvedAt} IS NOT NULL)`),
    index("payment_requests_workspace_status_created_idx").on(table.workspaceId, table.status, table.createdAt),
    index("payment_requests_status_created_idx").on(table.status, table.createdAt),
    // Anti-spam: at most one PENDING request per workspace (migration 0063).
    uniqueIndex("payment_requests_one_pending_per_workspace").on(table.workspaceId).where(sql`${table.status} = 'PENDING'`),
  ],
);
