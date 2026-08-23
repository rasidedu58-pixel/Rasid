/**
 * Schema module: idempotency
 *
 * Pulled forward into Phase 3 (originally a later slot in the illustrative
 * migration plan) because CreateMonth's `Idempotency-Key` contract (API
 * Contract §7) requires a durable store. Table shape is unchanged from
 * Database Schema v1.0 Approved §11.3 — only its migration timing differs
 * (same justification pattern as Phase 2 pulling `audit_events` forward).
 */
import { sql } from "drizzle-orm";
import { check, jsonb, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id").notNull(),
    operation: text("operation").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status").notNull().default("IN_PROGRESS"),
    responseCode: integer("response_code"),
    responsePayload: jsonb("response_payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [
    unique("idempotency_records_workspace_operation_key_unique").on(
      table.workspaceId,
      table.operation,
      table.key,
    ),
    check(
      "idempotency_records_status_check",
      sql`${table.status} IN ('IN_PROGRESS', 'COMPLETED', 'FAILED_RETRYABLE')`,
    ),
  ],
);
