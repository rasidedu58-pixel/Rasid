/**
 * Phase 15F — seeds the tagged RECOVERY_DRILL fixture used to prove a
 * backup/restore recovers real domain state end-to-end. Every row is named
 * or coded with the `RECOVERY_DRILL` tag so `recovery-cleanup-fixture.ts`
 * can remove it by exact match with zero risk to the standing QA data.
 *
 * Domain coverage (§3): one teacher workspace; owner + assistant membership;
 * 3 students; one active group + active operating month + group_month; three
 * enrollments; one COMPLETED session with an exam + attendance/homework/exam
 * records; finance with a partial payment, a fully-paid obligation, and a
 * reversed payment; one active attention case with a reason + evidence; a
 * pending follow-up + a contact log; one read + one unread notification; one
 * outbox event.
 *
 * Writes the generated IDs to `RECOVERY_IDS_FILE` (default
 * ./recovery-fixture-ids.json) for the capture/verify/cleanup steps.
 *
 * Usage: `MIGRATION_DATABASE_URL=... tsx src/scripts/recovery-seed-fixture.ts`
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import postgres from "postgres";

const TAG = "RECOVERY_DRILL";

async function main(): Promise<void> {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL is required.");
  const idsFile = process.env.RECOVERY_IDS_FILE ?? "./recovery-fixture-ids.json";
  const sql = postgres(url, { max: 2 });

  const id = {
    workspace: randomUUID(),
    owner: randomUUID(),
    assistant: randomUUID(),
    ownerMembership: randomUUID(),
    assistantMembership: randomUUID(),
    group: randomUUID(),
    month: randomUUID(),
    groupMonth: randomUUID(),
    students: [randomUUID(), randomUUID(), randomUUID()] as [string, string, string],
    guardian: randomUUID(),
    studentGuardian: randomUUID(),
    enrollments: [randomUUID(), randomUUID(), randomUUID()] as [string, string, string],
    session: randomUUID(),
    exam: randomUUID(),
    obligations: [randomUUID(), randomUUID(), randomUUID()] as [string, string, string],
    paymentPartial: randomUUID(),
    paymentFull: randomUUID(),
    paymentReversed: randomUUID(),
    reversal: randomUUID(),
    attentionCase: randomUUID(),
    attentionReason: randomUUID(),
    attentionEvidence: randomUUID(),
    followup: randomUUID(),
    contactLog: randomUUID(),
    notifRead: randomUUID(),
    notifUnread: randomUUID(),
    outbox: randomUUID(),
  };

  await sql.begin(async (tx) => {
    await tx`INSERT INTO users (id, full_name, email_display, status) VALUES
      (${id.owner}, ${`${TAG}::Owner`}, 'recovery-owner@example.test', 'ACTIVE'),
      (${id.assistant}, ${`${TAG}::Assistant`}, 'recovery-assistant@example.test', 'ACTIVE')`;

    await tx`INSERT INTO workspaces (id, owner_user_id, name, workspace_type, locale, timezone, due_date_policy, status)
      VALUES (${id.workspace}, ${id.owner}, ${`${TAG}::Workspace`}, 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE')`;

    await tx`INSERT INTO memberships (id, workspace_id, user_id, role_label, status, joined_at) VALUES
      (${id.ownerMembership}, ${id.workspace}, ${id.owner}, 'OWNER', 'ACTIVE', now()),
      (${id.assistantMembership}, ${id.workspace}, ${id.assistant}, 'ASSISTANT', 'ACTIVE', now())`;

    await tx`INSERT INTO groups (id, workspace_id, name, status) VALUES (${id.group}, ${id.workspace}, ${`${TAG}::Group`}, 'ACTIVE')`;

    await tx`INSERT INTO operating_months (id, workspace_id, year, month, status, created_by, activated_at)
      VALUES (${id.month}, ${id.workspace}, 2026, 8, 'CURRENT', ${id.owner}, now())`;

    await tx`INSERT INTO group_months (id, workspace_id, group_id, operating_month_id, base_fee_minor, currency_code, due_policy, join_fee_policy, monthly_status)
      VALUES (${id.groupMonth}, ${id.workspace}, ${id.group}, ${id.month}, 60000, 'EGP', 'PER_GROUP', 'FULL', 'ACTIVE')`;

    for (let i = 0; i < 3; i++) {
      await tx`INSERT INTO students (id, workspace_id, student_code, name, search_name_normalized, status, version)
        VALUES (${id.students[i]!}, ${id.workspace}, ${`RD-S${i + 1}`}, ${`${TAG}::Student ${i + 1}`}, ${`${TAG.toLowerCase()} student ${i + 1}`}, 'ACTIVE', 1)`;
    }

    await tx`INSERT INTO guardians (id, workspace_id, name, phone, normalized_phone, version)
      VALUES (${id.guardian}, ${id.workspace}, ${`${TAG}::Guardian`}, '+201000000001', '201000000001', 1)`;
    await tx`INSERT INTO student_guardians (id, workspace_id, student_id, guardian_id, relationship, is_primary)
      VALUES (${id.studentGuardian}, ${id.workspace}, ${id.students[0]}, ${id.guardian}, 'guardian', true)`;

    for (let i = 0; i < 3; i++) {
      await tx`INSERT INTO enrollments (id, workspace_id, student_id, group_month_id, join_date, status, fee_method)
        VALUES (${id.enrollments[i]!}, ${id.workspace}, ${id.students[i]!}, ${id.groupMonth}, '2026-08-01', 'ACTIVE', 'FULL_MONTH')`;
    }

    // One COMPLETED session with an exam + full attendance/homework/exam records.
    await tx`INSERT INTO sessions (id, workspace_id, group_month_id, scheduled_at, duration_minutes, status, origin, started_at, completed_at, created_by, version)
      VALUES (${id.session}, ${id.workspace}, ${id.groupMonth}, '2026-08-05T10:00:00Z', 60, 'COMPLETED', 'MANUAL', '2026-08-05T10:00:00Z', '2026-08-05T11:00:00Z', ${id.owner}, 1)`;
    await tx`INSERT INTO session_exams (id, workspace_id, session_id, name, max_score, version)
      VALUES (${id.exam}, ${id.workspace}, ${id.session}, ${`${TAG}::Exam`}, 100, 1)`;

    // S1 present/done/scored 85; S2 late/partial/scored 40; S3 absent/not_done/absent_from_exam.
    const recs = [
      { enr: id.enrollments[0], att: "PRESENT", hw: "DONE", exs: "SCORED", score: 85 },
      { enr: id.enrollments[1], att: "LATE", hw: "PARTIAL", exs: "SCORED", score: 40 },
      { enr: id.enrollments[2], att: "ABSENT", hw: "NOT_DONE", exs: "ABSENT_FROM_EXAM", score: null },
    ];
    for (const r of recs) {
      await tx`INSERT INTO session_records (id, workspace_id, group_month_id, session_id, enrollment_id, attendance_status, homework_status, exam_status, exam_score, created_by, version)
        VALUES (${randomUUID()}, ${id.workspace}, ${id.groupMonth}, ${id.session}, ${r.enr}, ${r.att}, ${r.hw}, ${r.exs}, ${r.score}, ${id.owner}, 1)`;
    }

    // Finance — S1 partial (paid 20000 of 60000), S2 fully paid, S3 reversed (paid then reversed -> back to unpaid).
    await tx`INSERT INTO financial_obligations (id, workspace_id, enrollment_id, currency_code, base_fee_minor, discount_minor, waiver_minor, net_due_minor, due_date, amount_paid_minor, remaining_minor, status, calculation_basis)
      VALUES (${id.obligations[0]}, ${id.workspace}, ${id.enrollments[0]}, 'EGP', 60000, 0, 0, 60000, '2026-08-10', 20000, 40000, 'PARTIAL', 'FULL_MONTH')`;
    await tx`INSERT INTO financial_obligations (id, workspace_id, enrollment_id, currency_code, base_fee_minor, discount_minor, waiver_minor, net_due_minor, due_date, amount_paid_minor, remaining_minor, status, calculation_basis)
      VALUES (${id.obligations[1]}, ${id.workspace}, ${id.enrollments[1]}, 'EGP', 60000, 0, 0, 60000, '2026-08-10', 60000, 0, 'PAID', 'FULL_MONTH')`;
    await tx`INSERT INTO financial_obligations (id, workspace_id, enrollment_id, currency_code, base_fee_minor, discount_minor, waiver_minor, net_due_minor, due_date, amount_paid_minor, remaining_minor, status, calculation_basis)
      VALUES (${id.obligations[2]}, ${id.workspace}, ${id.enrollments[2]}, 'EGP', 60000, 0, 0, 60000, '2026-08-10', 0, 60000, 'UNPAID', 'FULL_MONTH')`;

    await tx`INSERT INTO payments (id, workspace_id, obligation_id, amount_minor, currency_code, method, paid_at, status, idempotency_key, recorded_by)
      VALUES (${id.paymentPartial}, ${id.workspace}, ${id.obligations[0]}, 20000, 'EGP', 'CASH', '2026-08-06T09:00:00Z', 'POSTED', ${`${TAG}-pay-partial`}, ${id.owner})`;
    await tx`INSERT INTO payments (id, workspace_id, obligation_id, amount_minor, currency_code, method, paid_at, status, idempotency_key, recorded_by)
      VALUES (${id.paymentFull}, ${id.workspace}, ${id.obligations[1]}, 60000, 'EGP', 'CASH', '2026-08-06T09:05:00Z', 'POSTED', ${`${TAG}-pay-full`}, ${id.owner})`;
    // Reversed payment: the payment row is preserved (immutable history) with status REVERSED + a reversal row.
    await tx`INSERT INTO payments (id, workspace_id, obligation_id, amount_minor, currency_code, method, paid_at, status, idempotency_key, recorded_by)
      VALUES (${id.paymentReversed}, ${id.workspace}, ${id.obligations[2]}, 60000, 'EGP', 'CASH', '2026-08-06T09:10:00Z', 'REVERSED', ${`${TAG}-pay-reversed`}, ${id.owner})`;
    await tx`INSERT INTO payment_reversals (id, workspace_id, payment_id, reason, reversed_by)
      VALUES (${id.reversal}, ${id.workspace}, ${id.paymentReversed}, ${`${TAG}::wrong entry`}, ${id.owner})`;

    // Attention — active case for S1 with a reason + evidence.
    await tx`INSERT INTO attention_cases (id, workspace_id, student_id, status, priority, opened_at, last_qualified_at)
      VALUES (${id.attentionCase}, ${id.workspace}, ${id.students[0]}, 'IN_FOLLOWUP', 'HIGH', now(), now())`;
    await tx`INSERT INTO attention_reasons (id, workspace_id, attention_case_id, group_id, rule_key, severity, is_active)
      VALUES (${id.attentionReason}, ${id.workspace}, ${id.attentionCase}, ${id.group}, 'ATTENDANCE_ABSENCE_STREAK', 'HIGH', true)`;
    await tx`INSERT INTO attention_evidence (id, workspace_id, attention_reason_id, source_type, source_id, observed_at, evidence_snapshot)
      VALUES (${id.attentionEvidence}, ${id.workspace}, ${id.attentionReason}, 'SESSION_RECORD', ${id.session}, '2026-08-05T11:00:00Z', ${sql.json({ absences: 3 })})`;

    // Follow-up + contact log.
    await tx`INSERT INTO scheduled_followups (id, workspace_id, attention_case_id, student_id, due_at, status, assignee_membership_id)
      VALUES (${id.followup}, ${id.workspace}, ${id.attentionCase}, ${id.students[0]}, '2026-08-12T09:00:00Z', 'PENDING', ${id.ownerMembership})`;
    await tx`INSERT INTO contact_logs (id, workspace_id, student_id, guardian_id, attention_case_id, channel, draft_snapshot, outcome, actor_user_id, actor_membership_id)
      VALUES (${id.contactLog}, ${id.workspace}, ${id.students[0]}, ${id.guardian}, ${id.attentionCase}, 'WHATSAPP_DEEPLINK', ${`${TAG}::draft`}, 'CONTACTED', ${id.owner}, ${id.ownerMembership})`;

    // Notifications — one read, one unread (owner).
    await tx`INSERT INTO notifications (id, workspace_id, user_id, type, title, body, dedup_key, read_at) VALUES
      (${id.notifRead}, ${id.workspace}, ${id.owner}, 'FOLLOWUP_DUE', ${`${TAG}::read`}, 'body', ${`${TAG}-n-read`}, now()),
      (${id.notifUnread}, ${id.workspace}, ${id.owner}, 'MISSING_RECORDS', ${`${TAG}::unread`}, 'body', ${`${TAG}-n-unread`}, null)`;

    // Outbox — one representative pending event.
    await tx`INSERT INTO outbox_events (id, workspace_id, event_type, aggregate_type, aggregate_id, payload, status)
      VALUES (${id.outbox}, ${id.workspace}, ${`${TAG}.SessionCompleted`}, 'session', ${id.session}, ${sql.json({ tag: TAG })}, 'PENDING')`;
  });

  writeFileSync(idsFile, JSON.stringify({ tag: TAG, workspaceId: id.workspace, ids: id }, null, 2));
  // eslint-disable-next-line no-console
  console.log(`[recovery-seed-fixture] Seeded ${TAG} workspace ${id.workspace}. IDs -> ${idsFile}`);
  await sql.end();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("[recovery-seed-fixture] FAILED:", e);
  process.exit(1);
});
