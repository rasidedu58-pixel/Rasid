/**
 * Schema module: attention
 *
 * Phase 7 — implements `attention_cases` (Database Schema §9.1),
 * `attention_reasons` (§9.2), and `attention_evidence` (§9.3) as approved,
 * with one deliberate, minimal addition over the literal §9.2 column list:
 * `attention_reasons.group_id`.
 *
 * WHY: a Student can hold Enrollments in more than one Group in parallel,
 * while an AttentionCase is unified at (workspace_id, student_id) — never
 * per-group (§9.1's own partial-unique rule). Without a group anchor on the
 * REASON, a rule evaluated from Group A's session data and one evaluated
 * from Group B's session data would be indistinguishable once attached to
 * the shared Case, and `UNIQUE(attention_case_id, rule_key)` (§9.2, taken
 * literally) would silently MERGE two different groups' `absence.consecutive`
 * reasons into one row — a real cross-group data leak the moment that case
 * is rendered to a Group-Scoped caller. This was reviewed against the
 * approved schema first (§9.2 has no `group_id`); adding it is the smallest
 * change that restores per-group integrity: the case stays unified (one
 * row per student, per §9.1, unchanged), but each REASON — and therefore
 * every EVIDENCE row beneath it, since evidence links to a reason, not
 * directly to the case (§9.3) — carries the Group whose session data
 * produced it. `UNIQUE(attention_case_id, rule_key)` becomes
 * `UNIQUE(attention_case_id, group_id, rule_key)`.
 */
import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { students } from "./students";

export const attentionCases = pgTable(
  "attention_cases",
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
    status: text("status").notNull().default("NEW"),
    /** V1 approved simple rule: MEDIUM (any single qualifying rule) or HIGH (combined.medium, or escalated) — no LOW/lower tier exists. */
    priority: text("priority").notNull().default("MEDIUM"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().default(sql`now()`),
    lastQualifiedAt: timestamp("last_qualified_at", { withTimezone: true }).notNull().default(sql`now()`),
    contactedAt: timestamp("contacted_at", { withTimezone: true }),
    monitoringSince: timestamp("monitoring_since", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    check(
      "attention_cases_status_check",
      sql`${table.status} IN ('NEW', 'IN_FOLLOWUP', 'CONTACTED', 'MONITORING', 'CLOSED')`,
    ),
    check("attention_cases_priority_check", sql`${table.priority} IN ('MEDIUM', 'HIGH')`),
    // §9.1: "Partial UNIQUE(workspace_id, student_id) WHERE status <> 'CLOSED'.
    // الحالة تعبر الشهور ولا تغلق تلقائيًا لمجرد تغير الشهر." — at most one
    // non-CLOSED case per (workspace, student), enforced at the DB level.
    uniqueIndex("attention_cases_active_unique")
      .on(table.workspaceId, table.studentId)
      .where(sql`${table.status} <> 'CLOSED'`),
    // Also referenced by attention_reasons' composite FK (phase-local parent,
    // same convention as enrollments→financial_obligations in Phase 6).
    unique("attention_cases_id_workspace_id_unique").on(table.id, table.workspaceId),
    index("attention_cases_workspace_status_priority_idx").on(table.workspaceId, table.status, table.priority),
    // Phase 15 (0049) — serves the id-cursor-paginated cases list.
    index("attention_cases_workspace_status_id_idx").on(table.workspaceId, table.status, table.id),
  ],
);

export const attentionReasons = pgTable(
  "attention_reasons",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id").notNull(),
    attentionCaseId: uuid("attention_case_id")
      .notNull()
      .references(() => attentionCases.id, { onDelete: "restrict" }),
    /**
     * The Group whose session/record data produced this reason — see the
     * module doc comment above. Plain `uuid` (not a drizzle `.references()`)
     * because the cross-workspace integrity check for it is a hand-written
     * trigger (mirrors `enrollments`/`qr_credentials`'s own convention for
     * referencing a pre-existing table, Phase 4), not a composite FK.
     */
    groupId: uuid("group_id").notNull(),
    ruleKey: text("rule_key").notNull(),
    severity: text("severity").notNull(),
    firstDetectedAt: timestamp("first_detected_at", { withTimezone: true }).notNull().default(sql`now()`),
    lastDetectedAt: timestamp("last_detected_at", { withTimezone: true }).notNull().default(sql`now()`),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    check(
      "attention_reasons_severity_check",
      sql`${table.severity} IN ('MEDIUM', 'HIGH')`,
    ),
    // §9.2's UNIQUE(attention_case_id, rule_key), widened by `group_id` — see
    // module doc comment. A reason never duplicates as separate rows; Evidence
    // is what accumulates underneath it.
    unique("attention_reasons_case_group_rule_unique").on(table.attentionCaseId, table.groupId, table.ruleKey),
    // Referenced by attention_evidence's composite FK.
    unique("attention_reasons_id_workspace_id_unique").on(table.id, table.workspaceId),
    index("attention_reasons_case_idx").on(table.attentionCaseId),
    index("attention_reasons_group_idx").on(table.groupId),
  ],
);

export const attentionEvidence = pgTable(
  "attention_evidence",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id").notNull(),
    attentionReasonId: uuid("attention_reason_id")
      .notNull()
      .references(() => attentionReasons.id, { onDelete: "restrict" }),
    /** Closed to the two concrete source kinds the approved 6 active rules ever produce in V1 (§9.3 lists "SESSION_RECORD/SESSION/..." — no third kind exists for any enabled rule). */
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    /** Minimal necessary event facts only — never a full row dump (§9.3's own rule). */
    evidenceSnapshot: jsonb("evidence_snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    check("attention_evidence_source_type_check", sql`${table.sourceType} IN ('SESSION_RECORD', 'SESSION')`),
    // Re-processing the SAME SessionCompleted outbox event after a worker
    // crash/retry must never insert a duplicate Evidence row for the same
    // underlying fact — this is the idempotency backstop.
    unique("attention_evidence_reason_source_unique").on(table.attentionReasonId, table.sourceType, table.sourceId),
    index("attention_evidence_reason_observed_idx").on(table.attentionReasonId, table.observedAt),
  ],
);
