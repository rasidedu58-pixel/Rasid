/**
 * Schema module: qr_credentials
 *
 * Phase 4 — implements `qr_credentials` (Database Schema §6.4) exactly as
 * approved. `token_hash` stores a SHA-256 hex digest ONLY — the raw QR
 * token is never persisted anywhere; it is returned to the caller exactly
 * once, at issue/reissue time (API Contract §11.9's `qr.displayToken`).
 *
 * Enforces INT-04 (at most one ACTIVE QR credential per student) via a
 * partial UNIQUE index on `student_id` WHERE `status = 'ACTIVE'`.
 */
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { students } from "./students";
import { users } from "./identity";

export const qrCredentials = pgTable(
  "qr_credentials",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    // Denormalized like sessions.workspace_id — indexing/RLS.
    workspaceId: uuid("workspace_id").notNull(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    /** SHA-256 hex digest of the raw token — never the raw token itself. */
    tokenHash: text("token_hash").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().default(sql`now()`),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokeReason: text("revoke_reason"),
    issuedByUserId: uuid("issued_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    revokedByUserId: uuid("revoked_by_user_id").references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    check("qr_credentials_status_check", sql`${table.status} IN ('ACTIVE', 'REVOKED')`),
    // INT-04 — at most one ACTIVE credential per student.
    uniqueIndex("qr_credentials_student_active_unique")
      .on(table.studentId)
      .where(sql`${table.status} = 'ACTIVE'`),
    // Exact-hash lookup path for /qr/resolve — never fuzzy.
    index("qr_credentials_token_hash_idx").on(table.tokenHash),
    index("qr_credentials_workspace_student_idx").on(table.workspaceId, table.studentId),
  ],
);
