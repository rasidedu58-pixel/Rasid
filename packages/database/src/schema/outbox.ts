/**
 * Schema module: outbox_events
 *
 * Phase 5 Closure Delta — pulled forward from the Database Schema's
 * illustrative migration plan (`0016_outbox_idempotency`, §21) NOW because
 * Technical Architecture ADR-018 ("Internal Domain Events + Transactional
 * Outbox من البداية — APPROVED") and the Implementation Plan's own Phase 5
 * deliverable line ("Complete Session transaction + outbox; Attention
 * calculation downstream event-driven") both name it as Phase-5-owned
 * infrastructure, not a later phase — unlike `idempotency_records`, which
 * Phase 3 pulled forward for its OWN unrelated reason (CreateMonth's
 * Idempotency-Key), `outbox_events` was never actually deferred by any
 * governing doc; Phase 5's original skip ("no outbox_events table exists
 * yet") was a shortcut, not the approved design.
 *
 * Infrastructure ONLY in this delta — `SessionCompleted` rows are written
 * transactionally alongside session completion, but NO consumer/worker
 * reads or processes them yet (Attention Engine is explicitly out of scope
 * until a later phase). Rows accumulate in PENDING status; a future
 * worker phase owns dispatch/processing and its own DB role.
 */
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** NULL = system-level event (not tied to a single workspace) — none exist yet in practice, but the column allows it per Database Schema §11.2. */
    workspaceId: uuid("workspace_id"),
    eventType: text("event_type").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    payload: jsonb("payload").notNull(),
    /** Phase 10 adds `DEAD` — a terminal status for an event that exhausted `MAX_ATTEMPTS` retries (see worker/outbox-dispatcher.ts). Never picked up again by the normal claim query; requires an explicit operator replay. */
    status: text("status").notNull().default("PENDING"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().default(sql`now()`),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().default(sql`now()`),
    attemptCount: integer("attempt_count").notNull().default(0),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    /** Sanitized — never raw stack traces/secrets (Database Schema §11.2). */
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    check("outbox_events_status_check", sql`${table.status} IN ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'DEAD')`),
    // Phase 10 fix — widened to match the REAL claim query's own filter
    // exactly (`status IN ('PENDING','FAILED','PROCESSING')`, PROCESSING
    // included for crash/lease-expiry reclaim) — see migration 0046's own
    // comment for the EXPLAIN ANALYZE finding this fixes.
    index("outbox_events_status_available_at_idx")
      .on(table.status, table.availableAt)
      .where(sql`${table.status} IN ('PENDING', 'FAILED', 'PROCESSING')`),
  ],
);
