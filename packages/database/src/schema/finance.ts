/**
 * Schema module: finance
 *
 * Phase 6 — implements `financial_obligations`, `payments`,
 * `payment_reversals` (Database Schema §8.1/§8.2/§8.3) exactly as
 * approved. The Payment ledger + FinancialObligation ARE the financial
 * source of truth (§8.1's own callout box); `amount_paid_minor`/
 * `remaining_minor`/`status` on `financial_obligations` are cached
 * aggregates for read performance, recomputed transactionally from the
 * ledger — never mutated outside `recordPaymentTransaction`/
 * `reversePaymentTransaction`.
 *
 * Money is `bigint` (integer minor units) everywhere — never a floating
 * type (ADR-022).
 */
import { sql } from "drizzle-orm";
import { bigint, char, check, date, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity";
import { enrollments } from "./enrollments";

export const financialObligations = pgTable(
  "financial_obligations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    // Denormalized like sessions/enrollments.workspace_id — indexing/RLS.
    workspaceId: uuid("workspace_id").notNull(),
    /** One obligation per Enrollment, for its whole lifetime (join→withdraw→rejoin reuses the SAME enrollment row) — UNIQUE below. */
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => enrollments.id, { onDelete: "restrict" }),
    currencyCode: char("currency_code", { length: 3 }).notNull().default("EGP"),
    /** The enrollment's OWN calculated charge (FULL_MONTH/CUSTOM/REMAINING_SESSIONS — already resolved by the approved proration engine) — NOT the GroupMonth's raw policy fee. */
    baseFeeMinor: bigint("base_fee_minor", { mode: "number" }).notNull(),
    discountMinor: bigint("discount_minor", { mode: "number" }).notNull().default(0),
    waiverMinor: bigint("waiver_minor", { mode: "number" }).notNull().default(0),
    netDueMinor: bigint("net_due_minor", { mode: "number" }).notNull(),
    dueDate: date("due_date").notNull(),
    /** Cached aggregate — transactional only, recomputed from the payments ledger. */
    amountPaidMinor: bigint("amount_paid_minor", { mode: "number" }).notNull().default(0),
    /** Cached aggregate — transactional only. */
    remainingMinor: bigint("remaining_minor", { mode: "number" }).notNull(),
    status: text("status").notNull().default("UNPAID"),
    /** FULL_MONTH/CUSTOM/REMAINING_SESSIONS — mirrors enrollments.fee_method at the time this obligation was computed. */
    calculationBasis: text("calculation_basis").notNull(),
    /** Formula preview/auditable basis (proration inputs, group month base fee, etc.) — never authoritative, just explains netDueMinor. */
    calculationSnapshotJson: jsonb("calculation_snapshot_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    unique("financial_obligations_enrollment_unique").on(table.enrollmentId),
    check(
      "financial_obligations_status_check",
      sql`${table.status} IN ('UNPAID', 'PARTIAL', 'PAID')`,
    ),
    check(
      "financial_obligations_calculation_basis_check",
      sql`${table.calculationBasis} IN ('FULL_MONTH', 'CUSTOM', 'REMAINING_SESSIONS')`,
    ),
    check("financial_obligations_amounts_nonnegative_check", sql`${table.baseFeeMinor} >= 0 AND ${table.discountMinor} >= 0 AND ${table.waiverMinor} >= 0`),
    check("financial_obligations_discount_waiver_check", sql`${table.discountMinor} + ${table.waiverMinor} <= ${table.baseFeeMinor}`),
    check("financial_obligations_net_due_check", sql`${table.netDueMinor} = ${table.baseFeeMinor} - ${table.discountMinor} - ${table.waiverMinor}`),
    check("financial_obligations_paid_nonnegative_check", sql`${table.amountPaidMinor} >= 0`),
    check("financial_obligations_remaining_nonnegative_check", sql`${table.remainingMinor} >= 0`),
    check("financial_obligations_balance_check", sql`${table.amountPaidMinor} + ${table.remainingMinor} = ${table.netDueMinor}`),
    index("financial_obligations_workspace_status_due_date_idx").on(table.workspaceId, table.status, table.dueDate),
    index("financial_obligations_workspace_due_date_idx").on(table.workspaceId, table.dueDate),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id").notNull(),
    /** Explicit obligation choice — never auto-allocated across obligations. */
    obligationId: uuid("obligation_id")
      .notNull()
      .references(() => financialObligations.id, { onDelete: "restrict" }),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currencyCode: char("currency_code", { length: 3 }).notNull().default("EGP"),
    method: text("method").notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("POSTED"),
    note: text("note"),
    idempotencyKey: text("idempotency_key").notNull(),
    recordedByUserId: uuid("recorded_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Immutable ledger row — no `updated_at`; corrections are a NEW payment_reversals row, never an UPDATE of amount/status fields directly by ordinary flows. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    unique("payments_workspace_idempotency_key_unique").on(table.workspaceId, table.idempotencyKey),
    check("payments_amount_positive_check", sql`${table.amountMinor} > 0`),
    check("payments_method_check", sql`${table.method} IN ('CASH', 'TRANSFER', 'WALLET', 'OTHER')`),
    check("payments_status_check", sql`${table.status} IN ('POSTED', 'REVERSED')`),
    index("payments_workspace_obligation_paid_at_idx").on(table.workspaceId, table.obligationId, table.paidAt),
  ],
);

export const paymentReversals = pgTable(
  "payment_reversals",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id").notNull(),
    /** Original Payment row stays; UNIQUE below enforces at most one reversal per payment (V1). */
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    reversedByUserId: uuid("reversed_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reversedAt: timestamp("reversed_at", { withTimezone: true }).notNull().default(sql`now()`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [unique("payment_reversals_payment_unique").on(table.paymentId)],
);
