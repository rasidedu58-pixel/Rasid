/**
 * Schema module: subscription_payments (+ reversals) — Billing Engine, Phase 3.
 *
 * The IMMUTABLE commercial payment ledger for SaaS subscription payments —
 * distinct from the student-fee ledger in `finance.ts`. Mirrors that ledger's
 * philosophy (ADR-022): money is `bigint` minor units. A payment row is a TRULY
 * immutable posted fact — never UPDATEd, never DELETEd, and it carries NO mutable
 * status column: "reversed" is DERIVED from the existence of a
 * `subscription_payment_reversals` row for it (there is therefore no lever to
 * mutate the ledger later). `payment_request_id` is UNIQUE (one payment per
 * request) and `(workspace_id, idempotency_key)` is UNIQUE (no double-confirm).
 *
 * `confirmation_source` = MANUAL_ADMIN in V1; PAYMENT_GATEWAY_WEBHOOK is
 * reserved so a future automatic gateway converges on the SAME confirm path.
 */
import { sql } from "drizzle-orm";
import { bigint, char, check, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity";
import { paymentRequests } from "./payment-requests";

export const subscriptionPayments = pgTable(
  "subscription_payments",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    // Denormalized like finance.payments.workspace_id (indexing/RLS); no FK.
    workspaceId: uuid("workspace_id").notNull(),
    /** One payment per request — UNIQUE below. onDelete restrict (payment requests are never hard-deleted). */
    paymentRequestId: uuid("payment_request_id")
      .notNull()
      .references(() => paymentRequests.id, { onDelete: "restrict" }),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currencyCode: char("currency_code", { length: 3 }).notNull().default("EGP"),
    method: text("method").notNull(),
    confirmationSource: text("confirmation_source").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    confirmedByUserId: uuid("confirmed_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull(),
    /** Immutable ledger row — no `updated_at`, no `status`; corrections are a NEW subscription_payment_reversals row, never an UPDATE. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    unique("subscription_payments_request_unique").on(table.paymentRequestId),
    unique("subscription_payments_workspace_idempotency_key_unique").on(table.workspaceId, table.idempotencyKey),
    check("subscription_payments_amount_positive_check", sql`${table.amountMinor} > 0`),
    check("subscription_payments_method_check", sql`${table.method} IN ('INSTAPAY', 'VODAFONE_CASH', 'MANUAL_ADJUSTMENT')`),
    check("subscription_payments_source_check", sql`${table.confirmationSource} IN ('MANUAL_ADMIN', 'PAYMENT_GATEWAY_WEBHOOK')`),
    index("subscription_payments_workspace_created_idx").on(table.workspaceId, table.createdAt),
  ],
);

export const subscriptionPaymentReversals = pgTable(
  "subscription_payment_reversals",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id").notNull(),
    /** Original payment stays POSTED; UNIQUE enforces at most one reversal per payment (V1). */
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => subscriptionPayments.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    reversedByUserId: uuid("reversed_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reversedAt: timestamp("reversed_at", { withTimezone: true }).notNull().default(sql`now()`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [unique("subscription_payment_reversals_payment_unique").on(table.paymentId)],
);
