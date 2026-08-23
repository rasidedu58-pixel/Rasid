/**
 * Schema module: months
 *
 * Phase 3 — implements `locations` (Database Schema §5.1) and
 * `operating_months` (§5.2) exactly as approved.
 *
 * `locations` has no dedicated `/locations` endpoint in the approved API
 * Contract registry (Phase 3 pre-authorized scoping decision) — it exists
 * purely as an FK target for `groups.default_location_id` and
 * `group_months.location_id`, both nullable. The product can function with
 * zero location rows ever created.
 *
 * `operating_months` enforces INT-01 (exactly one CURRENT month per
 * workspace) via a PARTIAL UNIQUE index on `workspace_id` WHERE
 * `status = 'CURRENT'` — the database-level backstop; the application
 * service layer also guards this (see months application service).
 */
import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity";
import { workspaces } from "./workspaces";

export const locations = pgTable(
  "locations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [check("locations_status_check", sql`${table.status} IN ('ACTIVE', 'ARCHIVED')`)],
);

export const operatingMonths = pgTable(
  "operating_months",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    year: smallint("year").notNull(),
    month: smallint("month").notNull(),
    status: text("status").notNull().default("DRAFT"),
    createdByUserId: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    check("operating_months_year_check", sql`${table.year} BETWEEN 2020 AND 2100`),
    check("operating_months_month_check", sql`${table.month} BETWEEN 1 AND 12`),
    check(
      "operating_months_status_check",
      sql`${table.status} IN ('DRAFT', 'CURRENT', 'ARCHIVED')`,
    ),
    unique("operating_months_workspace_year_month_unique").on(
      table.workspaceId,
      table.year,
      table.month,
    ),
    // INT-01 — exactly one CURRENT operating month per workspace.
    uniqueIndex("operating_months_workspace_current_unique")
      .on(table.workspaceId)
      .where(sql`${table.status} = 'CURRENT'`),
  ],
);
