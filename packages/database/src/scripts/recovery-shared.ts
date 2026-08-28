/**
 * Phase 15F — Backup/Restore drill shared read helpers.
 *
 * SAFE + READ-ONLY. Both the pre-restore capture (against the live source)
 * and the post-restore verification (against the disposable restored target)
 * import the SAME two functions here, so "expected" and "actual" are read by
 * identical queries — a mismatch can only mean the data genuinely differs,
 * never that two hand-written queries drifted.
 *
 * `captureBaseline` snapshots schema-level shape + every launch-critical
 * table's row count. `buildFixtureState` snapshots the tagged RECOVERY_DRILL
 * fixture's exact domain state (identity, roster, session history, finance in
 * integer minor units, attention/follow-up, notifications). Neither writes.
 */
import type { Sql } from "postgres";

export const BASELINE_TABLES = [
  "workspaces",
  "users",
  "memberships",
  "students",
  "guardians",
  "student_guardians",
  "groups",
  "operating_months",
  "group_months",
  "enrollments",
  "sessions",
  "session_records",
  "session_exams",
  "financial_obligations",
  "payments",
  "payment_reversals",
  "attention_cases",
  "attention_reasons",
  "attention_evidence",
  "scheduled_followups",
  "contact_logs",
  "notifications",
  "outbox_events",
] as const;

export interface Baseline {
  postgresVersion: string;
  migrationCount: number;
  rlsEnabledTables: number;
  rlsPolicies: number;
  enumTypes: number;
  indexes: number;
  triggers: number;
  tableCounts: Record<string, number>;
}

export async function captureBaseline(sql: Sql): Promise<Baseline> {
  const [ver] = await sql<{ v: string }[]>`select version() as v`;
  const [mig] = await sql<{ c: number }[]>`select count(*)::int as c from drizzle.__drizzle_migrations`.catch(() => [{ c: -1 }]);
  const [rls] = await sql<{ c: number }[]>`select count(*)::int as c from pg_tables where schemaname='public' and rowsecurity=true`;
  const [pol] = await sql<{ c: number }[]>`select count(*)::int as c from pg_policies where schemaname='public'`;
  // Public-schema enums only — Rasid's own schema models enums as TEXT + CHECK
  // (so this is 0), and scoping avoids counting a managed platform's system
  // enums (auth/storage/realtime) that a bare restore target won't have.
  const [en] = await sql<{ c: number }[]>`
    select count(distinct t.typname)::int as c
    from pg_type t
    join pg_enum e on t.oid=e.enumtypid
    join pg_namespace n on n.oid=t.typnamespace
    where n.nspname='public'`;
  const [idx] = await sql<{ c: number }[]>`select count(*)::int as c from pg_indexes where schemaname='public'`;
  const [trg] = await sql<{ c: number }[]>`select count(*)::int as c from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal`;

  const tableCounts: Record<string, number> = {};
  for (const t of BASELINE_TABLES) {
    const [row] = await sql<{ c: number }[]>`select count(*)::int as c from ${sql(t)}`;
    tableCounts[t] = row?.c ?? 0;
  }

  return {
    postgresVersion: (ver?.v ?? "").split(",")[0]!,
    migrationCount: mig?.c ?? -1,
    rlsEnabledTables: rls?.c ?? 0,
    rlsPolicies: pol?.c ?? 0,
    enumTypes: en?.c ?? 0,
    indexes: idx?.c ?? 0,
    triggers: trg?.c ?? 0,
    tableCounts,
  };
}

export interface FixtureState {
  workspaceId: string;
  workspace: { name: string; status: string; ownerUserId: string } | null;
  memberships: Array<{ role: string; status: string; userId: string }>;
  students: Array<{ code: string; name: string; status: string; version: number }>;
  group: { name: string; status: string } | null;
  month: { year: number; month: number; status: string } | null;
  enrollments: number;
  sessions: Array<{ status: string; version: number; records: number }>;
  sessionRecords: Array<{ studentCode: string; attendance: string | null; homework: string | null; examStatus: string; examScore: string | null }>;
  finance: Array<{
    studentCode: string;
    netDueMinor: string;
    amountPaidMinor: string;
    remainingMinor: string;
    status: string;
    payments: Array<{ amountMinor: string; status: string }>;
    reversals: number;
  }>;
  financeTotals: { totalDueMinor: string; totalPaidMinor: string; totalRemainingMinor: string };
  attention: { status: string; priority: string; reasons: number; evidence: number } | null;
  followups: Array<{ status: string }>;
  contactLogs: number;
  notifications: { read: number; unread: number };
  outboxEvents: number;
}

/**
 * Reads the exact domain state of one RECOVERY_DRILL workspace. Ordered,
 * deterministic (every list is sorted by a stable natural key), and uses
 * integer minor-unit strings for all money so comparison is exact — never a
 * rendered/rounded total.
 */
export async function buildFixtureState(sql: Sql, workspaceId: string): Promise<FixtureState> {
  const [ws] = await sql<{ name: string; status: string; owner_user_id: string }[]>`
    select name, status, owner_user_id from workspaces where id=${workspaceId}`;

  const memberships = await sql<{ role_label: string; status: string; user_id: string }[]>`
    select role_label, status, user_id from memberships where workspace_id=${workspaceId} order by role_label`;

  const students = await sql<{ student_code: string; name: string; status: string; version: number }[]>`
    select student_code, name, status, version from students where workspace_id=${workspaceId} order by student_code`;

  const [grp] = await sql<{ name: string; status: string }[]>`
    select name, status from groups where workspace_id=${workspaceId} order by name limit 1`;

  const [mon] = await sql<{ year: number; month: number; status: string }[]>`
    select year, month, status from operating_months where workspace_id=${workspaceId} order by year, month limit 1`;

  const [enr] = await sql<{ c: number }[]>`select count(*)::int c from enrollments where workspace_id=${workspaceId}`;

  const sessions = await sql<{ status: string; version: number; records: number }[]>`
    select s.status, s.version, (select count(*)::int from session_records r where r.session_id=s.id) as records
    from sessions s where s.workspace_id=${workspaceId} order by s.scheduled_at`;

  const sessionRecords = await sql<{ student_code: string; attendance_status: string | null; homework_status: string | null; exam_status: string; exam_score: string | null }[]>`
    select st.student_code, r.attendance_status, r.homework_status, r.exam_status, r.exam_score::text
    from session_records r
    join enrollments e on e.id=r.enrollment_id
    join students st on st.id=e.student_id
    where r.workspace_id=${workspaceId}
    order by st.student_code`;

  const obligations = await sql<{ id: string; student_code: string; net_due_minor: string; amount_paid_minor: string; remaining_minor: string; status: string }[]>`
    select o.id, st.student_code, o.net_due_minor::text, o.amount_paid_minor::text, o.remaining_minor::text, o.status
    from financial_obligations o
    join enrollments e on e.id=o.enrollment_id
    join students st on st.id=e.student_id
    where o.workspace_id=${workspaceId}
    order by st.student_code`;

  const finance: FixtureState["finance"] = [];
  for (const o of obligations) {
    const payments = await sql<{ amount_minor: string; status: string }[]>`
      select amount_minor::text, status from payments where obligation_id=${o.id} order by paid_at`;
    const [rev] = await sql<{ c: number }[]>`
      select count(*)::int c from payment_reversals pr join payments p on p.id=pr.payment_id where p.obligation_id=${o.id}`;
    finance.push({
      studentCode: o.student_code,
      netDueMinor: o.net_due_minor,
      amountPaidMinor: o.amount_paid_minor,
      remainingMinor: o.remaining_minor,
      status: o.status,
      payments: payments.map((p) => ({ amountMinor: p.amount_minor, status: p.status })),
      reversals: rev?.c ?? 0,
    });
  }

  // Derived totals from the underlying rows (not a rendered figure) — exact BigInt sums.
  const totalDue = obligations.reduce((a, o) => a + BigInt(o.net_due_minor), 0n);
  const totalPaid = obligations.reduce((a, o) => a + BigInt(o.amount_paid_minor), 0n);
  const totalRemaining = obligations.reduce((a, o) => a + BigInt(o.remaining_minor), 0n);

  const [att] = await sql<{ status: string; priority: string }[]>`
    select status, priority from attention_cases where workspace_id=${workspaceId} order by opened_at limit 1`;
  let attention: FixtureState["attention"] = null;
  if (att) {
    const [rc] = await sql<{ c: number }[]>`select count(*)::int c from attention_reasons where workspace_id=${workspaceId}`;
    const [ec] = await sql<{ c: number }[]>`select count(*)::int c from attention_evidence where workspace_id=${workspaceId}`;
    attention = { status: att.status, priority: att.priority, reasons: rc?.c ?? 0, evidence: ec?.c ?? 0 };
  }

  const followups = await sql<{ status: string }[]>`
    select status from scheduled_followups where workspace_id=${workspaceId} order by due_at`;
  const [cl] = await sql<{ c: number }[]>`select count(*)::int c from contact_logs where workspace_id=${workspaceId}`;

  const [nread] = await sql<{ c: number }[]>`select count(*)::int c from notifications where workspace_id=${workspaceId} and read_at is not null`;
  const [nunread] = await sql<{ c: number }[]>`select count(*)::int c from notifications where workspace_id=${workspaceId} and read_at is null`;
  const [obx] = await sql<{ c: number }[]>`select count(*)::int c from outbox_events where workspace_id=${workspaceId}`;

  return {
    workspaceId,
    workspace: ws ? { name: ws.name, status: ws.status, ownerUserId: ws.owner_user_id } : null,
    memberships: memberships.map((m) => ({ role: m.role_label, status: m.status, userId: m.user_id })),
    students: students.map((s) => ({ code: s.student_code, name: s.name, status: s.status, version: s.version })),
    group: grp ? { name: grp.name, status: grp.status } : null,
    month: mon ? { year: mon.year, month: mon.month, status: mon.status } : null,
    enrollments: enr?.c ?? 0,
    sessions: sessions.map((s) => ({ status: s.status, version: s.version, records: s.records })),
    sessionRecords: sessionRecords.map((r) => ({
      studentCode: r.student_code,
      attendance: r.attendance_status,
      homework: r.homework_status,
      examStatus: r.exam_status,
      examScore: r.exam_score,
    })),
    finance,
    financeTotals: { totalDueMinor: totalDue.toString(), totalPaidMinor: totalPaid.toString(), totalRemainingMinor: totalRemaining.toString() },
    attention,
    followups: followups.map((f) => ({ status: f.status })),
    contactLogs: cl?.c ?? 0,
    notifications: { read: nread?.c ?? 0, unread: nunread?.c ?? 0 },
    outboxEvents: obx?.c ?? 0,
  };
}
