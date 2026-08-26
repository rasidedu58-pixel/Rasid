/**
 * Schema module: sessions
 *
 * Phase 3 — implements `sessions` (Database Schema §5.6) exactly as
 * approved.
 *
 * `IN_PROGRESS`/`COMPLETED` are part of the full status domain but are
 * UNREACHABLE via any Phase 3 endpoint — no `/sessions/:id/start|complete`
 * endpoint exists yet (Phase 5 owns those transitions). Only `SCHEDULED`
 * (generation), `CANCELLED` (cancel), and `RESCHEDULED` (original, via
 * reschedule) plus a fresh `SCHEDULED` replacement are reachable now.
 *
 * INT-06 — at most one replacement session per original — is enforced by
 * the partial UNIQUE index on `rescheduled_from_session_id` WHERE NOT NULL.
 */
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity";
import { groupMonths } from "./groups";

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    // Denormalized like permission_grants.workspace_id — indexing/RLS.
    workspaceId: uuid("workspace_id").notNull(),
    groupMonthId: uuid("group_month_id")
      .notNull()
      .references(() => groupMonths.id, { onDelete: "restrict" }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    status: text("status").notNull().default("SCHEDULED"),
    origin: text("origin").notNull(),
    rescheduledFromSessionId: uuid("rescheduled_from_session_id").references(
      (): AnyPgColumn => sessions.id,
      { onDelete: "restrict" },
    ),
    /**
     * Generated sessions are inserted with this explicitly TRUE (§33.1:
     * "total_actual_billable_sessions counts generated billable
     * occurrences"). Manual extra sessions default to the schema's own
     * DEFAULT (false).
     */
    billableForProration: boolean("billable_for_proration").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdByUserId: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    check(
      "sessions_status_check",
      sql`${table.status} IN ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'RESCHEDULED')`,
    ),
    check(
      "sessions_origin_check",
      sql`${table.origin} IN ('GENERATED', 'MANUAL', 'RESCHEDULE_REPLACEMENT')`,
    ),
    check("sessions_duration_minutes_check", sql`${table.durationMinutes} > 0`),
    check(
      "sessions_rescheduled_from_not_self_check",
      sql`${table.rescheduledFromSessionId} <> ${table.id}`,
    ),
    check(
      "sessions_origin_reschedule_replacement_check",
      sql`(${table.origin} = 'RESCHEDULE_REPLACEMENT') = (${table.rescheduledFromSessionId} IS NOT NULL)`,
    ),
    // INT-06 — one replacement session per original.
    uniqueIndex("sessions_rescheduled_from_session_unique")
      .on(table.rescheduledFromSessionId)
      .where(sql`${table.rescheduledFromSessionId} IS NOT NULL`),
    index("sessions_workspace_group_month_scheduled_idx").on(
      table.workspaceId,
      table.groupMonthId,
      table.scheduledAt,
    ),
    index("sessions_workspace_status_scheduled_idx").on(
      table.workspaceId,
      table.status,
      table.scheduledAt,
    ),
    // Phase 15 (0049) — worker global IN_PROGRESS scan (app_worker RLS has
    // no workspace predicate, so workspace-leading indexes can't serve it).
    index("sessions_in_progress_scan_idx")
      .on(table.scheduledAt)
      .where(sql`${table.status} = 'IN_PROGRESS'`),
  ],
);
