/**
 * Schema module: followup
 *
 * Phase 7 — implements `contact_logs` (Database Schema §9.4) and
 * `scheduled_followups` (§9.5) exactly as approved. No `group_id` widening
 * is needed here (unlike `attention_reasons` in `./attention.ts`) — both
 * tables are keyed to a specific Student/Case/Session/Guardian, and their
 * own Group-Scope leak-safety is enforced at the application-service layer
 * by requiring the referenced Case's evidence to be in the caller's scope
 * before a draft/log can even be built (never a schema-level concern).
 */
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, unique, uuid, integer } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { students } from "./students";
import { attentionCases } from "./attention";

export const contactLogs = pgTable(
  "contact_logs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    /** Plain `uuid` (not `.references()`) — cross-workspace integrity for this and `session_id` is a hand-written trigger, mirroring `contact_logs`' own mixed-table-reference shape (Guardian/Session are pre-existing Phase 4/5 tables). */
    guardianId: uuid("guardian_id").notNull(),
    /** §15 ON DELETE policy: "ContactLog optional Session/Case context — SET NULL فقط إذا بقي السجل مفهومًا" — nullable, never cascades the log itself away. */
    attentionCaseId: uuid("attention_case_id").references(() => attentionCases.id, { onDelete: "set null" }),
    sessionId: uuid("session_id"),
    channel: text("channel").notNull(),
    /** Immutable — the exact text as it stood before the channel was opened (§9.4: "النص قبل فتح القناة"). Never edited after insert. */
    draftSnapshot: text("draft_snapshot").notNull(),
    outcome: text("outcome").notNull(),
    notes: text("notes"),
    /** Required exactly when outcome=DEFERRED (§9.4: "مطلوب عند DEFERRED"). */
    followUpAt: timestamp("follow_up_at", { withTimezone: true }),
    actorUserId: uuid("actor_user_id").notNull(),
    actorMembershipId: uuid("actor_membership_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    check("contact_logs_channel_check", sql`${table.channel} IN ('WHATSAPP_DEEPLINK', 'CALL', 'OTHER')`),
    check(
      "contact_logs_outcome_check",
      sql`${table.outcome} IN ('CONTACTED', 'NO_ANSWER', 'INVALID_NUMBER', 'DEFERRED')`,
    ),
    check(
      "contact_logs_follow_up_at_required_on_defer_check",
      sql`(${table.outcome} = 'DEFERRED') = (${table.followUpAt} IS NOT NULL)`,
    ),
    // Referenced by scheduled_followups' composite FK (source_contact_log_id).
    unique("contact_logs_id_workspace_id_unique").on(table.id, table.workspaceId),
    index("contact_logs_student_idx").on(table.studentId),
    index("contact_logs_case_idx").on(table.attentionCaseId),
  ],
);

export const scheduledFollowups = pgTable(
  "scheduled_followups",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    attentionCaseId: uuid("attention_case_id")
      .notNull()
      .references(() => attentionCases.id, { onDelete: "restrict" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("PENDING"),
    /** Plain `uuid` — no reassignment flow exists in the approved docs (no endpoint, no business rule beyond the column) — never mutated by any endpoint in this phase; present only so a future phase can wire it without a migration. */
    assigneeMembershipId: uuid("assignee_membership_id"),
    sourceContactLogId: uuid("source_contact_log_id").references(() => contactLogs.id, { onDelete: "set null" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    check("scheduled_followups_status_check", sql`${table.status} IN ('PENDING', 'DONE', 'CANCELLED')`),
    index("scheduled_followups_workspace_status_due_idx").on(table.workspaceId, table.status, table.dueAt),
  ],
);
