/**
 * Marketing demo seed — populates ONE existing, already-authenticated demo
 * workspace with a rich-but-calm dataset for landing-page product
 * screenshots (Marketing Demo + Product Showcase initiative).
 *
 * This reuses the SAME account that produced the very first real hero
 * screenshot (`public/hero-dashboard.png`) — user "أ. كريم عبد الله"
 * (id 75a03468-38ac-45fc-b42f-840ae9e66464, a Supabase-Auth-backed account
 * whose email already carries an explicit "demo" tag:
 * rasid.hero.demo.9x4k2@gmail.com), owning workspace
 * ad0e2049-6071-425d-b6e7-869906223fec. No new account/user/password is
 * created here (this script never touches Supabase Auth — it only writes
 * product-domain rows for a user id that must already exist). Three of the
 * eighteen seeded students deliberately reuse names/amounts that already
 * appear in the published hero screenshot ("نور الدين حسام" — absence
 * streak, "مصطفى ماهر فؤاد" — ٣٠٠ ج.م remaining, "زياد طارق منصور" — ٢٠٠
 * ج.م remaining) so a freshly recaptured screenshot stays internally
 * consistent with the one already live, per the "same account, same names"
 * requirement.
 *
 * Deliberately bypasses the NestJS application layer — exactly like the
 * only existing seed precedent in this package, `seed-scale-dataset.ts`
 * (raw multi-row INSERTs via the privileged `MIGRATION_DATABASE_URL`
 * connection) — because a full Nest DI bootstrap for a one-off marketing
 * script would be heavy and fragile, and this reuses the SAME safe pattern
 * this package already established rather than inventing a new one.
 *
 * IDEMPOTENT BY DESIGN (§U): every run first deletes every row currently
 * scoped to this ONE workspace id, in FK-safe order (same order
 * `cleanup-scale-dataset.ts` uses), then re-inserts the full scenario fresh.
 * No other workspace is ever touched — every DELETE is scoped by this exact
 * `WORKSPACE_ID`, never a LIKE/prefix match. Re-running never duplicates
 * rows, never doubles payments/sessions/followups.
 *
 * Usage: `pnpm --filter @academic-precision/database demo:seed`
 * (or the root convenience alias `pnpm demo:marketing:seed`).
 * Requires `MIGRATION_DATABASE_URL`. Optional overrides:
 *   DEMO_MARKETING_USER_ID, DEMO_MARKETING_WORKSPACE_ID — point the seed at
 *   a different existing user/workspace (still never creates the account).
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";

const USER_ID = process.env.DEMO_MARKETING_USER_ID ?? "75a03468-38ac-45fc-b42f-840ae9e66464";
const WORKSPACE_ID = process.env.DEMO_MARKETING_WORKSPACE_ID ?? "ad0e2049-6071-425d-b6e7-869906223fec";
const WORKSPACE_NAME = "مجموعات كريم عبد الله — حساب Demo تسويقي";
const CURRENCY = "EGP";
const BASE_FEE_MINOR = 30_000; // 300.00 EGP — one realistic, unified group fee.

/** Lightweight Arabic search-name normalizer — good enough for a marketing
 * seed (strips tashkeel/diacritics and collapses whitespace); NOT a claim
 * that it matches the product's own `arabic-normalize.ts` byte-for-byte. */
function normalizeArabic(name: string): string {
  return name
    .replace(/[ً-ٰٟ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function minor(egp: number): number {
  return Math.round(egp * 100);
}

async function main(): Promise<void> {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL is required.");
  const sql = postgres(url, { max: 4 });

  const owner = await sql`SELECT id, full_name FROM users WHERE id = ${USER_ID}`;
  if (owner.length === 0) {
    await sql.end();
    throw new Error(
      `[seed-marketing-demo] No user with id=${USER_ID} exists. This script never creates a Supabase Auth account — ` +
        `sign the demo account up for real first (or pass DEMO_MARKETING_USER_ID for an existing one).`,
    );
  }
  const wsRow = await sql`SELECT id, owner_user_id FROM workspaces WHERE id = ${WORKSPACE_ID}`;
  if (wsRow.length === 0 || wsRow[0]!.owner_user_id !== USER_ID) {
    await sql.end();
    throw new Error(`[seed-marketing-demo] Workspace ${WORKSPACE_ID} does not exist or is not owned by ${USER_ID}. Refusing to guess.`);
  }

  console.log(`[seed-marketing-demo] target workspace=${WORKSPACE_ID} owner="${owner[0]!.full_name}"`);

  // Everything below — the full reset + re-seed — runs in ONE database
  // transaction. This is a hard lesson from a real incident: an earlier,
  // non-transactional version of this script hit an unanticipated FK
  // (`qr_credentials`) mid-reset and crashed after several DELETEs had
  // already individually committed, permanently losing real rows in a
  // workspace that turned out to have production-shaped data. A single
  // transaction means ANY failure — an unknown FK, a constraint violation,
  // anything — rolls back everything, every time, leaving the target
  // workspace exactly as it was before the run. Never re-introduce
  // individually-committed statements here.
  await sql.begin(async (sql) => {
    // ---- Reset (§U): wipe every row currently scoped to THIS workspace
    // only, in FK-safe order — never touches any other workspace. ----
    await sql`DELETE FROM scheduled_followups WHERE workspace_id = ${WORKSPACE_ID}`;
    await sql`DELETE FROM contact_logs WHERE workspace_id = ${WORKSPACE_ID}`;
    await sql`DELETE FROM attention_evidence WHERE workspace_id = ${WORKSPACE_ID}`;
    await sql`DELETE FROM attention_reasons WHERE workspace_id = ${WORKSPACE_ID}`;
    await sql`DELETE FROM attention_cases WHERE workspace_id = ${WORKSPACE_ID}`;
    await sql`DELETE FROM payment_reversals WHERE workspace_id = ${WORKSPACE_ID}`;
    await sql`DELETE FROM payments WHERE workspace_id = ${WORKSPACE_ID}`;
    await sql`DELETE FROM financial_obligations WHERE workspace_id = ${WORKSPACE_ID}`;
    await sql`DELETE FROM session_records WHERE workspace_id = ${WORKSPACE_ID}`;
    // qr_credentials/session_exams reference sessions/students directly and
    // are NOT part of this seed's own domain, but a target workspace with
    // real prior usage can still have rows here — must clear them before
    // sessions/students can be deleted.
    await sql`DELETE FROM session_exams WHERE workspace_id = ${WORKSPACE_ID}`;
    await sql`DELETE FROM sessions WHERE workspace_id = ${WORKSPACE_ID}`;
    await sql`DELETE FROM student_guardians WHERE workspace_id = ${WORKSPACE_ID}`;
    await sql`DELETE FROM guardians WHERE workspace_id = ${WORKSPACE_ID}`;
    await sql`DELETE FROM enrollments WHERE workspace_id = ${WORKSPACE_ID}`;
    const targetStudentIds = (await sql`SELECT id FROM students WHERE workspace_id = ${WORKSPACE_ID}`).map((r) => r.id as string);
    if (targetStudentIds.length > 0) {
      await sql`DELETE FROM qr_credentials WHERE student_id = ANY(${targetStudentIds})`;
    }
    await sql`DELETE FROM students WHERE workspace_id = ${WORKSPACE_ID}`;
    await sql`DELETE FROM schedule_rules WHERE workspace_id = ${WORKSPACE_ID}`;
    const targetGroupIds = (await sql`SELECT id FROM groups WHERE workspace_id = ${WORKSPACE_ID}`).map((r) => r.id as string);
    if (targetGroupIds.length > 0) {
      await sql`DELETE FROM permission_group_scopes WHERE group_id = ANY(${targetGroupIds})`;
    }
    await sql`DELETE FROM group_months WHERE workspace_id = ${WORKSPACE_ID}`;
    await sql`DELETE FROM operating_months WHERE workspace_id = ${WORKSPACE_ID}`;
    await sql`DELETE FROM groups WHERE workspace_id = ${WORKSPACE_ID}`;
    console.log("[seed-marketing-demo] previous demo data cleared.");

  await sql`UPDATE workspaces SET name = ${WORKSPACE_NAME}, updated_at = now() WHERE id = ${WORKSPACE_ID}`;

  // ---- Operating month (CURRENT) ----
  const now = new Date();
  const operatingMonth = { id: randomUUID(), workspace_id: WORKSPACE_ID, year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, status: "CURRENT", created_by: USER_ID };
  await sql`INSERT INTO operating_months ${sql(operatingMonth)}`;

  // ---- Groups (§B3 — small / medium / larger, different schedules) ----
  const GROUPS = [
    { key: "math", name: "رياضيات - الصف الأول الثانوي", subject: "رياضيات", grade: "الصف الأول الثانوي", weekday: 6, startTime: "16:00", duration: 90 }, // Sat
    { key: "physics", name: "فيزياء - الصف الثاني الثانوي", subject: "فيزياء", grade: "الصف الثاني الثانوي", weekday: 0, startTime: "17:30", duration: 90 }, // Sun
    { key: "chemistry", name: "كيمياء - الصف الثالث الثانوي", subject: "كيمياء", grade: "الصف الثالث الثانوي", weekday: 1, startTime: "19:00", duration: 90 }, // Mon
  ] as const;

  const groupRows = GROUPS.map((g) => ({ id: randomUUID(), workspace_id: WORKSPACE_ID, name: g.name, subject: g.subject, grade: g.grade, status: "ACTIVE" }));
  await sql`INSERT INTO groups ${sql(groupRows)}`;

  const groupMonthRows = groupRows.map((g) => ({
    id: randomUUID(),
    workspace_id: WORKSPACE_ID,
    group_id: g.id,
    operating_month_id: operatingMonth.id,
    base_fee_minor: BASE_FEE_MINOR,
    currency_code: CURRENCY,
    due_policy: "PER_GROUP",
    join_fee_policy: "FULL",
    monthly_status: "ACTIVE",
  }));
  await sql`INSERT INTO group_months ${sql(groupMonthRows)}`;

  const scheduleRuleRows = GROUPS.map((g, i) => ({
    id: randomUUID(),
    workspace_id: WORKSPACE_ID,
    group_month_id: groupMonthRows[i]!.id,
    weekday: g.weekday,
    start_time: g.startTime,
    duration_minutes: g.duration,
  }));
  await sql`INSERT INTO schedule_rules ${sql(scheduleRuleRows)}`;
  console.log(`[seed-marketing-demo] groups: ${groupRows.length}`);

  const gmByKey = new Map(GROUPS.map((g, i) => [g.key, groupMonthRows[i]!]));

  // ---- Students (§B2 — 18, realistic fake Arabic names). Three names/
  // amounts are shared with the already-published hero screenshot for
  // cross-screenshot continuity (§T). ----
  type StudentPlan = { name: string; group: (typeof GROUPS)[number]["key"] };
  const STUDENTS: StudentPlan[] = [
    { name: "يوسف أحمد السيد", group: "math" },
    { name: "مريم خالد إبراهيم", group: "math" },
    { name: "نور الدين حسام", group: "math" }, // reused from hero-dashboard.png
    { name: "مصطفى ماهر فؤاد", group: "math" }, // reused — ٣٠٠ ج.م متبقٍ
    { name: "عبدالرحمن محمود فتحي", group: "physics" },
    { name: "سلمى وائل عبدالعزيز", group: "physics" },
    { name: "زياد طارق منصور", group: "physics" }, // reused — ٢٠٠ ج.م متبقٍ
    { name: "حبيبة عمرو الشريف", group: "physics" },
    { name: "آدم رامي توفيق", group: "physics" },
    { name: "جنى محمد العدوي", group: "physics" },
    { name: "كريم أشرف نبيل", group: "chemistry" },
    { name: "رهف سامح جاد", group: "chemistry" },
    { name: "علي حازم البدري", group: "chemistry" },
    { name: "ملك أيمن رزق", group: "chemistry" },
    { name: "حمزة وليد عاطف", group: "chemistry" },
    { name: "ياسمين شريف الدسوقي", group: "chemistry" },
    { name: "طارق سعيد جمال", group: "chemistry" },
    { name: "دينا عادل حلمي", group: "chemistry" },
  ];

  const studentRows = STUDENTS.map((s, i) => ({
    id: randomUUID(),
    workspace_id: WORKSPACE_ID,
    student_code: `DEMO-${String(i + 1).padStart(3, "0")}`,
    name: s.name,
    search_name_normalized: normalizeArabic(s.name),
    status: "ACTIVE",
  }));
  await sql`INSERT INTO students ${sql(studentRows)}`;

  const joinDate = new Date(operatingMonth.year, operatingMonth.month - 1, 1).toISOString().slice(0, 10);
  // زياد طارق منصور gets a CUSTOM fee (200 EGP) so his obligation matches the
  // published screenshot's "٢٠٠ ج.م متبقٍ" exactly — everyone else pays the
  // group's unified 300 EGP full-month fee.
  const enrollmentRows = studentRows.map((st, i) => {
    const plan = STUDENTS[i]!;
    const gm = gmByKey.get(plan.group)!;
    const isZiad = plan.name === "زياد طارق منصور";
    return {
      id: randomUUID(),
      workspace_id: WORKSPACE_ID,
      student_id: st.id,
      group_month_id: gm.id,
      join_date: joinDate,
      status: "ACTIVE",
      fee_method: isZiad ? "CUSTOM" : "FULL_MONTH",
      custom_fee_minor: isZiad ? minor(200) : null,
    };
  });
  await sql`INSERT INTO enrollments ${sql(enrollmentRows)}`;
  console.log(`[seed-marketing-demo] students: ${studentRows.length}, enrollments: ${enrollmentRows.length}`);

  const enrollmentByStudentName = new Map(STUDENTS.map((s, i) => [s.name, enrollmentRows[i]!]));
  const studentIdByName = new Map(STUDENTS.map((s, i) => [s.name, studentRows[i]!.id]));

  // ---- Sessions (§B4/§B5 — one IN_PROGRESS "now", two SCHEDULED "today"/
  // "tomorrow", three COMPLETED with real attendance/homework variety). ----
  const hourMs = 3_600_000;
  const dayMs = 24 * hourMs;

  const mathGm = gmByKey.get("math")!;
  const physicsGm = gmByKey.get("physics")!;
  const chemistryGm = gmByKey.get("chemistry")!;

  const sessionsPlan = [
    // S1 — "الحصة الجارية الآن" (matches the live dashboard's IN_PROGRESS treatment).
    { gm: mathGm, offsetMs: -20 * 60_000, duration: 90, status: "IN_PROGRESS", started: true },
    // S2 — completed 2 days ago, richest attendance/homework mix.
    { gm: mathGm, offsetMs: -2 * dayMs, duration: 90, status: "COMPLETED" },
    // S3 — scheduled later today.
    { gm: physicsGm, offsetMs: 3 * hourMs, duration: 90, status: "SCHEDULED" },
    // S4 — completed 5 days ago.
    { gm: physicsGm, offsetMs: -5 * dayMs, duration: 90, status: "COMPLETED" },
    // S5 — scheduled tomorrow.
    { gm: chemistryGm, offsetMs: dayMs + 4 * hourMs, duration: 90, status: "SCHEDULED" },
    // S6 — completed 8 days ago.
    { gm: chemistryGm, offsetMs: -8 * dayMs, duration: 90, status: "COMPLETED" },
  ] as const;

  const sessionRows = sessionsPlan.map((s) => {
    const scheduledAt = new Date(now.getTime() + s.offsetMs);
    return {
      id: randomUUID(),
      workspace_id: WORKSPACE_ID,
      group_month_id: s.gm.id,
      scheduled_at: scheduledAt,
      duration_minutes: s.duration,
      status: s.status,
      origin: "GENERATED",
      billable_for_proration: true,
      started_at: s.status === "IN_PROGRESS" || s.status === "COMPLETED" ? scheduledAt : null,
      completed_at: s.status === "COMPLETED" ? new Date(scheduledAt.getTime() + s.duration * 60_000) : null,
      created_by: USER_ID,
    };
  });
  await sql`INSERT INTO sessions ${sql(sessionRows)}`;
  console.log(`[seed-marketing-demo] sessions: ${sessionRows.length}`);

  // session_records — only for sessions with actual roster interaction
  // (the IN_PROGRESS one and the three COMPLETED ones); SCHEDULED sessions
  // get none (attendance genuinely hasn't happened yet).
  const enrollmentsByGroupMonth = new Map<string, typeof enrollmentRows>();
  for (const e of enrollmentRows) {
    const list = enrollmentsByGroupMonth.get(e.group_month_id) ?? [];
    list.push(e);
    enrollmentsByGroupMonth.set(e.group_month_id, list);
  }

  const attendanceCycle = ["PRESENT", "PRESENT", "ABSENT", "PRESENT", "LATE", "PRESENT", "PRESENT", "ABSENT"] as const;
  const homeworkCycle = ["DONE", "DONE", "PARTIAL", "DONE", "NOT_DONE", "DONE", "PARTIAL", "DONE"] as const;

  const recordRows: Record<string, unknown>[] = [];
  sessionRows.forEach((session, sIdx) => {
    const plan = sessionsPlan[sIdx]!;
    if (plan.status === "SCHEDULED") return;
    const roster = enrollmentsByGroupMonth.get(plan.gm.id) ?? [];
    roster.forEach((e, i) => {
      // The in-progress session (today) only has attendance for students
      // marked so far in the live session — homework isn't assigned yet.
      const isLive = plan.status === "IN_PROGRESS";
      recordRows.push({
        id: randomUUID(),
        workspace_id: WORKSPACE_ID,
        group_month_id: plan.gm.id,
        session_id: session.id,
        enrollment_id: e.id,
        attendance_status: isLive ? (i < Math.ceil(roster.length / 2) ? attendanceCycle[i % attendanceCycle.length] : null) : attendanceCycle[i % attendanceCycle.length],
        homework_status: isLive ? null : homeworkCycle[i % homeworkCycle.length],
      });
    });
  });
  await sql`INSERT INTO session_records ${sql(recordRows)}`;
  console.log(`[seed-marketing-demo] session_records: ${recordRows.length}`);

  // ---- Finance (§B7) — realistic PAID/PARTIAL/UNPAID mix, one overdue, one
  // reversal on a row that is NOT part of the headline continuity names. ----
  const dueDateOf = (daysFromNow: number) => new Date(now.getTime() + daysFromNow * dayMs).toISOString().slice(0, 10);

  const obligationRows = enrollmentRows.map((e, i) => {
    const studentName = STUDENTS[i]!.name;
    const baseFee = studentName === "زياد طارق منصور" ? minor(200) : BASE_FEE_MINOR;
    let paid = 0;
    let dueDays = 10; // default: not due yet
    let status: "UNPAID" | "PARTIAL" | "PAID" = "UNPAID";

    if (studentName === "مصطفى ماهر فؤاد") {
      paid = 0;
      dueDays = -3; // overdue — matches the published "عاجل" urgent item
      status = "UNPAID";
    } else if (studentName === "زياد طارق منصور") {
      paid = 0;
      dueDays = 5;
      status = "UNPAID";
    } else {
      const bucket = i % 5; // ~40% PAID, ~20% PARTIAL, ~40% UNPAID across the rest
      if (bucket < 2) {
        paid = baseFee;
        status = "PAID";
        dueDays = 12;
      } else if (bucket === 2) {
        paid = Math.round(baseFee * 0.5);
        status = "PARTIAL";
        dueDays = 3;
      } else if (bucket === 3) {
        paid = 0;
        status = "UNPAID";
        dueDays = -1; // one more small overdue case, spread across the list
      } else {
        paid = 0;
        status = "UNPAID";
        dueDays = 15;
      }
    }

    return {
      id: randomUUID(),
      workspace_id: WORKSPACE_ID,
      enrollment_id: e.id,
      currency_code: CURRENCY,
      base_fee_minor: baseFee,
      discount_minor: 0,
      waiver_minor: 0,
      net_due_minor: baseFee,
      due_date: dueDateOf(dueDays),
      amount_paid_minor: paid,
      remaining_minor: baseFee - paid,
      status,
      calculation_basis: studentName === "زياد طارق منصور" ? "CUSTOM" : "FULL_MONTH",
      _studentName: studentName,
    };
  });
  const obligationInsertRows = obligationRows.map(({ _studentName, ...row }) => row);
  await sql`INSERT INTO financial_obligations ${sql(obligationInsertRows)}`;

  const paidRows = obligationRows.filter((o) => o.amount_paid_minor > 0);
  const paymentRows = paidRows.map((o, i) => ({
    id: randomUUID(),
    workspace_id: WORKSPACE_ID,
    obligation_id: o.id,
    amount_minor: o.amount_paid_minor,
    currency_code: CURRENCY,
    method: i % 3 === 0 ? "TRANSFER" : "CASH",
    paid_at: new Date(now.getTime() - (2 + i) * dayMs),
    status: "POSTED",
    idempotency_key: `demo-marketing-pay-${i}`,
    recorded_by: USER_ID,
  }));
  await sql`INSERT INTO payments ${sql(paymentRows)}`;

  // One reversal — on a PAID (not PARTIAL) row that isn't one of the three
  // continuity names, so the primary finance story stays uncluttered.
  const reversalTarget = paidRows.find((o) => o.status === "PAID" && !["مصطفى ماهر فؤاد", "زياد طارق منصور", "نور الدين حسام"].includes(o._studentName));
  if (reversalTarget) {
    const payment = paymentRows[paidRows.indexOf(reversalTarget)]!;
    await sql`INSERT INTO payment_reversals ${sql([
      { id: randomUUID(), workspace_id: WORKSPACE_ID, payment_id: payment.id, reason: "تصحيح: الدفعة سُجّلت بالخطأ على هذا الطالب", reversed_by: USER_ID },
    ])}`;
    await sql`UPDATE payments SET status = 'REVERSED' WHERE id = ${payment.id}`;
    await sql`UPDATE financial_obligations SET amount_paid_minor = 0, remaining_minor = ${reversalTarget.net_due_minor}, status = 'UNPAID' WHERE id = ${reversalTarget.id}`;
  }
  console.log(`[seed-marketing-demo] financial_obligations: ${obligationInsertRows.length}, payments: ${paymentRows.length}, reversals: ${reversalTarget ? 1 : 0}`);

  // ---- Attention / Followups (§B6) — direct rows (no direct "create case"
  // service exists; real cases are produced by the background rules worker
  // from session/session_record events — same documented approach
  // `seed-scale-dataset.ts` uses under SEED_ATTENTION=1). ----
  const mathGroupId = groupRows[0]!.id;
  const physicsGroupId = groupRows[1]!.id;
  const chemistryGroupId = groupRows[2]!.id;

  type CasePlan = {
    student: string;
    groupId: string;
    status: string;
    priority: "MEDIUM" | "HIGH";
    ruleKey: string;
    followup?: { dueOffsetDays: number; status: "PENDING" | "DONE" };
    contactLog?: { outcome: string; channel: string };
  };
  const CASES: CasePlan[] = [
    // "متابعة اليوم" — matches the published "غياب متكرر" urgent item.
    { student: "نور الدين حسام", groupId: mathGroupId, status: "IN_FOLLOWUP", priority: "HIGH", ruleKey: "ABSENCE_STREAK", followup: { dueOffsetDays: 0, status: "PENDING" } },
    // "متابعة متأخرة".
    { student: "طارق سعيد جمال", groupId: chemistryGroupId, status: "IN_FOLLOWUP", priority: "MEDIUM", ruleKey: "MISSING_RECORDS", followup: { dueOffsetDays: -3, status: "PENDING" } },
    // "تحتاج review" — monitoring, no imminent followup.
    { student: "حبيبة عمرو الشريف", groupId: physicsGroupId, status: "MONITORING", priority: "MEDIUM", ruleKey: "HOMEWORK_STREAK" },
    // "حالة completed" — closed case with a real contact-log + a DONE followup.
    { student: "رهف سامح جاد", groupId: chemistryGroupId, status: "CLOSED", priority: "MEDIUM", ruleKey: "ABSENCE_STREAK", followup: { dueOffsetDays: -6, status: "DONE" }, contactLog: { outcome: "CONTACTED", channel: "WHATSAPP_DEEPLINK" } },
  ];

  const caseRows = CASES.map((c) => ({
    id: randomUUID(),
    workspace_id: WORKSPACE_ID,
    student_id: studentIdByName.get(c.student)!,
    status: c.status,
    priority: c.priority,
    opened_at: new Date(now.getTime() - 4 * dayMs),
    last_qualified_at: new Date(now.getTime() - 1 * dayMs),
    contacted_at: c.status === "CLOSED" || c.status === "IN_FOLLOWUP" ? new Date(now.getTime() - 2 * dayMs) : null,
    monitoring_since: c.status === "MONITORING" ? new Date(now.getTime() - 2 * dayMs) : null,
    closed_at: c.status === "CLOSED" ? new Date(now.getTime() - 1 * dayMs) : null,
  }));
  await sql`INSERT INTO attention_cases ${sql(caseRows)}`;

  // One reason per case, evidenced by a real seeded session (the completed
  // session belonging to the case's own group) — real linkage, not a random id.
  const completedSessionByGroupMonth = new Map<string, (typeof sessionRows)[number]>();
  sessionRows.forEach((s, i) => {
    if (sessionsPlan[i]!.status === "COMPLETED") completedSessionByGroupMonth.set(s.group_month_id, s);
  });
  const gmIdByGroupId = new Map<string, string>(GROUPS.map((g, i) => [groupRows[i]!.id, groupMonthRows[i]!.id]));

  const reasonRows = CASES.map((c, i) => ({
    id: randomUUID(),
    workspace_id: WORKSPACE_ID,
    attention_case_id: caseRows[i]!.id,
    group_id: c.groupId,
    rule_key: c.ruleKey,
    severity: c.priority,
    first_detected_at: new Date(now.getTime() - 4 * dayMs),
    last_detected_at: new Date(now.getTime() - 1 * dayMs),
    is_active: c.status !== "CLOSED",
  }));
  await sql`INSERT INTO attention_reasons ${sql(reasonRows)}`;

  const evidenceRows = CASES.map((c, i) => {
    const gmId = gmIdByGroupId.get(c.groupId)!;
    const evidenceSession = completedSessionByGroupMonth.get(gmId);
    return {
      id: randomUUID(),
      workspace_id: WORKSPACE_ID,
      attention_reason_id: reasonRows[i]!.id,
      source_type: "SESSION" as const,
      source_id: evidenceSession?.id ?? sessionRows[0]!.id,
      observed_at: new Date(now.getTime() - 2 * dayMs),
      evidence_snapshot: { ruleKey: c.ruleKey, studentName: c.student },
    };
  });
  await sql`INSERT INTO attention_evidence ${sql(evidenceRows)}`;

  const followupCases = CASES.map((c, i) => ({ c, caseRow: caseRows[i]! })).filter((x) => x.c.followup);
  const followupRows = followupCases.map(({ c, caseRow }) => ({
    id: randomUUID(),
    workspace_id: WORKSPACE_ID,
    attention_case_id: caseRow.id,
    student_id: studentIdByName.get(c.student)!,
    due_at: new Date(now.getTime() + c.followup!.dueOffsetDays * dayMs),
    status: c.followup!.status,
    completed_at: c.followup!.status === "DONE" ? new Date(now.getTime() - 1 * dayMs) : null,
  }));
  if (followupRows.length > 0) await sql`INSERT INTO scheduled_followups ${sql(followupRows)}`;

  // A contact log's guardian must be a REAL guardian row in this same
  // workspace (enforced by a hand-written same-workspace trigger) — create
  // one primary guardian per student that needs a contact log.
  const contactLogCases = CASES.map((c, i) => ({ c, caseRow: caseRows[i]! })).filter((x) => x.c.contactLog);
  const guardianRows = contactLogCases.map(({ c }) => ({
    id: randomUUID(),
    workspace_id: WORKSPACE_ID,
    name: `ولي أمر ${c.student}`,
    phone: "01000000000",
    normalized_phone: "201000000000",
  }));
  if (guardianRows.length > 0) await sql`INSERT INTO guardians ${sql(guardianRows)}`;
  const studentGuardianRows = contactLogCases.map(({ c }, i) => ({
    id: randomUUID(),
    workspace_id: WORKSPACE_ID,
    student_id: studentIdByName.get(c.student)!,
    guardian_id: guardianRows[i]!.id,
    relationship: "أب",
    is_primary: true,
  }));
  if (studentGuardianRows.length > 0) await sql`INSERT INTO student_guardians ${sql(studentGuardianRows)}`;

  const contactLogRows = contactLogCases.map(({ c, caseRow }, i) => ({
    id: randomUUID(),
    workspace_id: WORKSPACE_ID,
    student_id: studentIdByName.get(c.student)!,
    guardian_id: guardianRows[i]!.id,
    attention_case_id: caseRow.id,
    session_id: null,
    channel: c.contactLog!.channel,
    draft_snapshot: `مرحبًا، نود المتابعة بخصوص ${c.student} — تم التواصل وتوضيح الموقف، وأُغلقت الحالة.`,
    outcome: c.contactLog!.outcome,
    notes: "تم التواصل مع ولي الأمر وأُغلقت الحالة بعد المتابعة.",
    follow_up_at: null,
    actor_user_id: USER_ID,
  }));
  if (contactLogRows.length > 0) await sql`INSERT INTO contact_logs ${sql(contactLogRows)}`;

  console.log(
    `[seed-marketing-demo] attention_cases: ${caseRows.length}, reasons: ${reasonRows.length}, evidence: ${evidenceRows.length}, ` +
      `followups: ${followupRows.length}, contact_logs: ${contactLogRows.length}`,
  );

    console.log(`[seed-marketing-demo] DONE. Workspace "${WORKSPACE_NAME}" (${WORKSPACE_ID}) is ready.`);
  });
  await sql.end();
}

main().catch((error) => {
  console.error("[seed-marketing-demo] FAILED:", error);
  process.exit(1);
});
