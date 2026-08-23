/**
 * Schema module: groups
 *
 * Phase 3 — implements `groups` (Database Schema §5.3), `group_months`
 * (§5.4), and `schedule_rules` (§5.5) exactly as approved.
 *
 * `groups` deliberately has NO month_id, fee, or schedule columns — a Group
 * is a durable identity across months; per-month commercial/schedule facts
 * live on `group_months`/`schedule_rules` (§5.3 explicit prohibition).
 *
 * `group_months` enforces INT-02 (a Group has at most one GroupMonth per
 * OperatingMonth) via UNIQUE(group_id, operating_month_id).
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  date,
  index,
  integer,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { locations, operatingMonths } from "./months";
import { workspaces } from "./workspaces";

export const groups = pgTable(
  "groups",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    subject: text("subject"),
    grade: text("grade"),
    defaultLocationId: uuid("default_location_id").references(() => locations.id, {
      onDelete: "restrict",
    }),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    check("groups_status_check", sql`${table.status} IN ('ACTIVE', 'ARCHIVED')`),
    index("groups_workspace_status_idx").on(table.workspaceId, table.status),
  ],
);

export const groupMonths = pgTable(
  "group_months",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "restrict" }),
    operatingMonthId: uuid("operating_month_id")
      .notNull()
      .references(() => operatingMonths.id, { onDelete: "restrict" }),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "restrict" }),
    baseFeeMinor: bigint("base_fee_minor", { mode: "number" }).notNull(),
    currencyCode: char("currency_code", { length: 3 }).notNull().default("EGP"),
    duePolicy: text("due_policy").notNull(),
    dueDay: smallint("due_day"),
    joinFeePolicy: text("join_fee_policy").notNull(),
    monthlyStatus: text("monthly_status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    check("group_months_base_fee_minor_check", sql`${table.baseFeeMinor} >= 0`),
    check(
      "group_months_due_policy_check",
      sql`${table.duePolicy} IN ('UNIFIED', 'PER_GROUP', 'OVERRIDE')`,
    ),
    check(
      "group_months_due_day_check",
      sql`${table.dueDay} IS NULL OR ${table.dueDay} BETWEEN 1 AND 28`,
    ),
    check(
      "group_months_join_fee_policy_check",
      sql`${table.joinFeePolicy} IN ('ASK_EVERY_TIME', 'FULL', 'REMAINING')`,
    ),
    check(
      "group_months_monthly_status_check",
      sql`${table.monthlyStatus} IN ('ACTIVE', 'ARCHIVED')`,
    ),
    unique("group_months_group_operating_month_unique").on(
      table.groupId,
      table.operatingMonthId,
    ),
    index("group_months_workspace_operating_month_idx").on(
      table.workspaceId,
      table.operatingMonthId,
    ),
  ],
);

export const scheduleRules = pgTable(
  "schedule_rules",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    // Denormalized like permission_grants.workspace_id — indexing/RLS.
    workspaceId: uuid("workspace_id").notNull(),
    groupMonthId: uuid("group_month_id")
      .notNull()
      .references(() => groupMonths.id, { onDelete: "restrict" }),
    /**
     * 0..6, ISO-style, 0 = Monday .. 6 = Sunday (documented convention — see
     * the session-generation algorithm module for the authoritative
     * definition; this is an implementation-detail choice, applied
     * consistently, not a product decision).
     */
    weekday: smallint("weekday").notNull(),
    startTime: time("start_time").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    check("schedule_rules_weekday_check", sql`${table.weekday} BETWEEN 0 AND 6`),
    check("schedule_rules_duration_minutes_check", sql`${table.durationMinutes} > 0`),
    index("schedule_rules_group_month_idx").on(table.groupMonthId),
  ],
);
