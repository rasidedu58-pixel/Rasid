/**
 * Schema module: notifications
 *
 * Phase 9 — implements `notifications` (Database Schema §10.4) exactly as
 * approved, plus one deliberate, minimal addition over the literal column
 * list: `dedup_key`.
 *
 * WHY `dedup_key`: the Phase 9 Closure correction requires a DB-level
 * dedup invariant (not just an application-side "did I already send this?"
 * query), because the notification GENERATOR is a worker scan job that can
 * run concurrently/be retried — a query-then-insert race would otherwise
 * produce duplicate rows. `UNIQUE(workspace_id, user_id, type, entity_type,
 * entity_id, dedup_key)` makes every generator call a plain
 * `INSERT ... ON CONFLICT DO NOTHING`, atomically safe under concurrency.
 * `dedup_key` differs per notification type:
 *   - SUBSCRIPTION_EXPIRING: "7d" | "3d" | "1d" (one row per reminder point,
 *     never re-created once inserted for that point — see
 *     `worker/notifications-scan.ts`'s window-based, not exact-instant,
 *     matching logic).
 *   - FOLLOWUP_DUE: the scheduled_followups row's own id (one notification
 *     per follow-up becoming due; a completed/rescheduled follow-up is
 *     simply never re-scanned, never producing a second one).
 *   - MISSING_RECORDS: the sessions row's own id (one notification per
 *     session ever found to have a real missing-records gap, per the SAME
 *     Phase 5 `computeReview`-derived definition — never "session overdue").
 */
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { users } from "./identity";

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    /** The recipient — see `worker/notifications-scan.ts` for exactly who each type notifies (Owner for subscription/missing-records; the follow-up's assignee, falling back to Owner, for follow-up-due). */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    /** Dedup partition key — see module doc comment. Always populated by the generator (never truly "no dedup key"), even though the column itself is nullable-shaped like `entity_type`/`entity_id` for schema symmetry. */
    dedupKey: text("dedup_key").notNull(),
    /** NULL = unread. Set once, by the recipient's own `POST /notifications/:id/read` or `/read-all` — never by the worker. */
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    check(
      "notifications_type_check",
      // Phase 6 (0070) widened this with the billing lifecycle set. Legacy types kept for historical rows.
      sql`${table.type} IN ('SUBSCRIPTION_EXPIRING', 'FOLLOWUP_DUE', 'MISSING_RECORDS', 'TRIAL_ENDING', 'TRIAL_EXPIRED', 'SUBSCRIPTION_ENDING', 'SUBSCRIPTION_EXPIRED', 'PAYMENT_REQUEST_CREATED', 'PAYMENT_REQUEST_EXPIRING', 'PAYMENT_REQUEST_EXPIRED', 'PAYMENT_CONFIRMED', 'PAYMENT_REJECTED', 'CAPACITY_STUDENTS', 'CAPACITY_TEAM', 'CUSTOM_OFFER_READY', 'CUSTOM_OFFER_EXPIRING', 'CUSTOM_OFFER_ACCEPTED_PAYMENT_PENDING', 'CUSTOM_OFFER_APPLIED', 'CUSTOM_REQUEST_CREATED', 'NEW_PAYMENT_PROOF_PENDING')`,
    ),
    // The DB-level dedup invariant itself — see module doc comment.
    unique("notifications_dedup_unique").on(
      table.workspaceId,
      table.userId,
      table.type,
      table.entityType,
      table.entityId,
      table.dedupKey,
    ),
    // Database Schema §13's own named index — backs `GET /notifications`'s read/unread-ordered list.
    index("notifications_user_read_created_idx").on(table.userId, table.readAt, table.createdAt),
    // Phase 15 (0049) — worker dedup pre-check lookup shape.
    index("notifications_workspace_entity_type_idx").on(table.workspaceId, table.entityType, table.entityId, table.type),
  ],
);
