/**
 * Schema module: reports
 *
 * Phase 9 — `exports` is a minimal, necessary technical table, not part of
 * the literal Database Schema v1.0 column list (which names no dedicated
 * Reports/Export table at all — reports are computed live per ADR-020, "PostgreSQL
 * first"). Same category of addition as Phase 8's `owner_trial_grants`: the
 * API Contract §9.10/§11.17 literally requires `POST /reports/export`,
 * `GET /exports/{id}`, and their `exportId`/`status`/`downloadUrl` shape, so
 * SOME durable, id-addressable resource is unavoidable.
 *
 * Deliberately METADATA ONLY — no CSV content column. Per the Phase 9
 * Closure correction: V1 never needs true async (every report is bounded to
 * one student/one group/one month, so generation always completes
 * synchronously), and no object storage exists in this codebase yet. Rather
 * than persist a CSV blob in Postgres (a "permanent file store" the
 * correction explicitly rejects) or invent a storage layer, `GET
 * /exports/{id}/download` RE-COMPUTES the export from `params` at download
 * time, through the exact same `reports/reports.repository.ts` query
 * functions `POST /reports/export` used to validate the request originally.
 * This has two deliberate benefits, not just a storage-avoidance shortcut:
 *   1. Permission/Entitlement/Group-Scope are re-checked at DOWNLOAD time
 *      (not just at creation time) — a caller who loses access between
 *      creating and downloading an export is correctly blocked, exactly as
 *      required.
 *   2. The exported data is always current as of the download moment
 *      (no snapshot-staleness concern), which the approved docs never
 *      require to be otherwise.
 * `expires_at` is short-lived (see `reports.repository.ts`'s constant) —
 * once expired, the row is simply refused (no re-generation, no DELETE
 * needed for correctness — an expired row is inert, and a periodic cleanup
 * is an operational nicety, not a correctness requirement).
 */
import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { memberships } from "./permissions";

// Named `reportExports` (not `exports`) purely because `exports` is a
// reserved identifier in a CommonJS module's top-level scope — the actual
// Postgres table name is still `exports`, matching the API Contract's own
// `/exports/{id}` path.
export const reportExports = pgTable(
  "exports",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    requestedByMembershipId: uuid("requested_by_membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "restrict" }),
    /** STUDENT/GROUP/MONTHLY_TEACHER — matches the report `type` the API Contract §11.17 example uses for `POST /reports/export`. */
    type: text("type").notNull(),
    /** V1's only format — enforced structurally (no PDF/XLSX code path exists), CHECK is a defense-in-depth reminder, not the only enforcement. */
    format: text("format").notNull().default("CSV"),
    /** Everything needed to RE-RUN the same report query at download time — studentId/groupId/monthId + filters. Never CSV content. */
    params: jsonb("params").notNull(),
    /** Kept as a real enum (not collapsed to a boolean) for forward-compat with a genuine async worker later, even though V1 only ever writes READY (or FAILED, if the underlying report query itself errors). */
    status: text("status").notNull().default("READY"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check("exports_type_check", sql`${table.type} IN ('STUDENT', 'GROUP', 'MONTHLY_TEACHER')`),
    check("exports_format_check", sql`${table.format} = 'CSV'`),
    check("exports_status_check", sql`${table.status} IN ('QUEUED', 'READY', 'FAILED')`),
    index("exports_workspace_created_idx").on(table.workspaceId, table.createdAt),
  ],
);
