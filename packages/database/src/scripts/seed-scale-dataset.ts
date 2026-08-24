/**
 * Phase 10 — synthetic scale dataset generator. No real personal data
 * anywhere — every name/email/phone is a deterministic, obviously-fake
 * string tagged with the run's own id, so the entire dataset is trivially
 * identifiable and removable (`cleanup-scale-dataset.ts`).
 *
 * Reference model (Phase 10 correction, NOT the earlier "30,000 workspaces"
 * draft): ~1,000 workspaces × ~30 teacher/membership identities each
 * (≈30,000 membership rows total) × up to hundreds of thousands of
 * students × millions of session/session_record rows over TIME (not all
 * generated up front in one run — that volume accrues operationally over
 * months of real usage, not from a single seed).
 *
 * This script is fully parametrized so it can target ANY point on that
 * curve — including the full reference model, if run against
 * infrastructure sized for it. It does NOT claim the current shared
 * Supabase dev project can absorb the full model; see the Phase 10 report
 * for the actual tested scale and the `ENVIRONMENT CAPACITY LIMIT` this
 * project's tier imposes beyond it.
 *
 * Deliberately bypasses the application layer entirely (no HTTP, no
 * NestJS, no business-rule validation) — bulk multi-row `INSERT`s via the
 * privileged migration connection, exactly like every live integration
 * test's own `beforeAll` seeding, just at volume. This is a data-shape
 * generator for query/index/load testing, not a functional-correctness
 * tool (functional correctness is what the Jest/Vitest suites already
 * prove).
 *
 * Usage: `RUN_TAG=scale1 WORKSPACES=50 MEMBERSHIPS_PER_WORKSPACE=30
 * STUDENTS_PER_WORKSPACE=200 SESSIONS_PER_GROUP_MONTH=20
 * tsx src/scripts/seed-scale-dataset.ts` (every var optional, see DEFAULTS
 * below). Requires `MIGRATION_DATABASE_URL`.
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";

const DEFAULTS = {
  WORKSPACES: 50,
  MEMBERSHIPS_PER_WORKSPACE: 30,
  STUDENTS_PER_WORKSPACE: 200,
  GROUPS_PER_WORKSPACE: 8,
  SESSIONS_PER_GROUP_MONTH: 20,
};

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const RUN_TAG = process.env.RUN_TAG ?? `scale-${Date.now()}`;
const WORKSPACES = envInt("WORKSPACES", DEFAULTS.WORKSPACES);
const MEMBERSHIPS_PER_WORKSPACE = envInt("MEMBERSHIPS_PER_WORKSPACE", DEFAULTS.MEMBERSHIPS_PER_WORKSPACE);
const STUDENTS_PER_WORKSPACE = envInt("STUDENTS_PER_WORKSPACE", DEFAULTS.STUDENTS_PER_WORKSPACE);
const GROUPS_PER_WORKSPACE = envInt("GROUPS_PER_WORKSPACE", DEFAULTS.GROUPS_PER_WORKSPACE);
const SESSIONS_PER_GROUP_MONTH = envInt("SESSIONS_PER_GROUP_MONTH", DEFAULTS.SESSIONS_PER_GROUP_MONTH);

const NAME_PREFIX = `SCALE-${RUN_TAG}`;
const BATCH_SIZE = 1000;

async function insertBatched<T>(
  sql: postgres.Sql,
  rows: T[],
  insertFn: (sql: postgres.Sql, batch: T[]) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    await insertFn(sql, rows.slice(i, i + BATCH_SIZE));
  }
}

async function main(): Promise<void> {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL is required.");
  const sql = postgres(url, { max: 4 });

  const startedAt = Date.now();
  console.log(
    `[seed-scale-dataset] run="${RUN_TAG}" workspaces=${WORKSPACES} ` +
      `memberships/ws=${MEMBERSHIPS_PER_WORKSPACE} students/ws=${STUDENTS_PER_WORKSPACE} ` +
      `groups/ws=${GROUPS_PER_WORKSPACE} sessions/group_month=${SESSIONS_PER_GROUP_MONTH}`,
  );

  // ---- Users (one owner + N assistant identities per workspace) ----
  type UserRow = { id: string; name: string; email: string };
  const owners: UserRow[] = [];
  const allMembers: { id: string; name: string; email: string; workspaceIndex: number }[] = [];
  for (let w = 0; w < WORKSPACES; w++) {
    const owner: UserRow = { id: randomUUID(), name: `${NAME_PREFIX} Owner ${w}`, email: `${NAME_PREFIX.toLowerCase()}-owner-${w}@scale.test` };
    owners.push(owner);
    for (let m = 0; m < MEMBERSHIPS_PER_WORKSPACE; m++) {
      allMembers.push({ id: randomUUID(), name: `${NAME_PREFIX} Member ${w}-${m}`, email: `${NAME_PREFIX.toLowerCase()}-m-${w}-${m}@scale.test`, workspaceIndex: w });
    }
  }
  const allUserRows = [...owners, ...allMembers];
  await insertBatched(sql, allUserRows, (s, batch) =>
    s`INSERT INTO users ${s(batch.map((u) => ({ id: u.id, full_name: u.name, email_display: u.email, status: "ACTIVE" })))}`,
  );
  console.log(`[seed-scale-dataset] users: ${allUserRows.length}`);

  // ---- Workspaces ----
  const workspaces = owners.map((owner, w) => ({
    id: randomUUID(),
    owner_user_id: owner.id,
    name: `${NAME_PREFIX} Workspace ${w}`,
    workspace_type: "TEACHER",
    locale: "ar-EG",
    timezone: "Africa/Cairo",
    due_date_policy: "PER_GROUP",
    status: "ACTIVE",
  }));
  await insertBatched(sql, workspaces, (s, batch) => s`INSERT INTO workspaces ${s(batch)}`);
  console.log(`[seed-scale-dataset] workspaces: ${workspaces.length}`);

  // ---- Memberships (Owner + assistants per workspace) ----
  const memberships = workspaces.flatMap((ws, w) => {
    const now = new Date();
    const ownerMembership = { id: randomUUID(), workspace_id: ws.id, user_id: owners[w]!.id, role_label: "OWNER", status: "ACTIVE", joined_at: now };
    const assistantMemberships = allMembers
      .filter((m) => m.workspaceIndex === w)
      .map((m) => ({ id: randomUUID(), workspace_id: ws.id, user_id: m.id, role_label: "ASSISTANT", status: "ACTIVE", joined_at: now }));
    return [ownerMembership, ...assistantMemberships];
  });
  await insertBatched(sql, memberships, (s, batch) => s`INSERT INTO memberships ${s(batch)}`);
  console.log(`[seed-scale-dataset] memberships: ${memberships.length}`);

  // ---- Groups + CURRENT operating month + group_months ----
  const groups = workspaces.flatMap((ws, w) =>
    Array.from({ length: GROUPS_PER_WORKSPACE }, (_, g) => ({ id: randomUUID(), workspace_id: ws.id, name: `${NAME_PREFIX} Group ${w}-${g}`, status: "ACTIVE" })),
  );
  await insertBatched(sql, groups, (s, batch) => s`INSERT INTO groups ${s(batch)}`);

  const months = workspaces.map((ws, w) => ({ id: randomUUID(), workspace_id: ws.id, year: 2026, month: 8, status: "CURRENT", created_by: owners[w]!.id }));
  await insertBatched(sql, months, (s, batch) => s`INSERT INTO operating_months ${s(batch)}`);

  const groupMonths = groups.map((g, i) => {
    const w = Math.floor(i / GROUPS_PER_WORKSPACE);
    return { id: randomUUID(), workspace_id: g.workspace_id, group_id: g.id, operating_month_id: months[w]!.id, base_fee_minor: 30000, due_policy: "PER_GROUP", join_fee_policy: "FULL" };
  });
  await insertBatched(sql, groupMonths, (s, batch) => s`INSERT INTO group_months ${s(batch)}`);
  console.log(`[seed-scale-dataset] groups: ${groups.length}, group_months: ${groupMonths.length}`);

  // ---- Students + enrollments (round-robin across the workspace's own groupMonths) ----
  const students = workspaces.flatMap((ws, w) =>
    Array.from({ length: STUDENTS_PER_WORKSPACE }, (_, i) => ({
      id: randomUUID(),
      workspace_id: ws.id,
      student_code: `${NAME_PREFIX.slice(0, 12)}-${w}-${i}`,
      name: `${NAME_PREFIX} Student ${w}-${i}`,
      search_name_normalized: `student ${w} ${i}`,
      status: "ACTIVE",
    })),
  );
  await insertBatched(sql, students, (s, batch) => s`INSERT INTO students ${s(batch)}`);

  const groupMonthsByWorkspace = new Map<string, typeof groupMonths>();
  for (const gm of groupMonths) {
    const list = groupMonthsByWorkspace.get(gm.workspace_id) ?? [];
    list.push(gm);
    groupMonthsByWorkspace.set(gm.workspace_id, list);
  }
  const enrollments = students.map((st, i) => {
    const wsGroupMonths = groupMonthsByWorkspace.get(st.workspace_id)!;
    const gm = wsGroupMonths[i % wsGroupMonths.length]!;
    return { id: randomUUID(), workspace_id: st.workspace_id, student_id: st.id, group_month_id: gm.id, join_date: "2026-08-01", status: "ACTIVE", fee_method: "FULL_MONTH" };
  });
  await insertBatched(sql, enrollments, (s, batch) => s`INSERT INTO enrollments ${s(batch)}`);
  console.log(`[seed-scale-dataset] students: ${students.length}, enrollments: ${enrollments.length}`);

  // ---- Sessions + session_records (the real volume driver) ----
  const enrollmentsByGroupMonth = new Map<string, typeof enrollments>();
  for (const e of enrollments) {
    const list = enrollmentsByGroupMonth.get(e.group_month_id) ?? [];
    list.push(e);
    enrollmentsByGroupMonth.set(e.group_month_id, list);
  }

  let totalSessions = 0;
  let totalRecords = 0;
  for (const gm of groupMonths) {
    const sessions = Array.from({ length: SESSIONS_PER_GROUP_MONTH }, (_, i) => ({
      id: randomUUID(),
      workspace_id: gm.workspace_id,
      group_month_id: gm.id,
      scheduled_at: new Date(`2026-08-${String((i % 27) + 1).padStart(2, "0")}T08:00:00Z`),
      duration_minutes: 60,
      status: "COMPLETED",
      origin: "GENERATED",
      created_by: owners[workspaces.findIndex((w) => w.id === gm.workspace_id)]!.id,
    }));
    await sql`INSERT INTO sessions ${sql(sessions)}`;
    totalSessions += sessions.length;

    const groupEnrollments = enrollmentsByGroupMonth.get(gm.id) ?? [];
    const records = sessions.flatMap((session) =>
      groupEnrollments.map((e) => ({
        id: randomUUID(),
        workspace_id: gm.workspace_id,
        group_month_id: gm.id,
        session_id: session.id,
        enrollment_id: e.id,
        attendance_status: "PRESENT",
        homework_status: "DONE",
      })),
    );
    await insertBatched(sql, records, (s, batch) => s`INSERT INTO session_records ${s(batch)}`);
    totalRecords += records.length;
  }
  console.log(`[seed-scale-dataset] sessions: ${totalSessions}, session_records: ${totalRecords}`);

  const elapsedS = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[seed-scale-dataset] DONE in ${elapsedS}s. Run tag: ${RUN_TAG} (use this with cleanup-scale-dataset.ts).`);
  await sql.end();
}

main().catch((error) => {
  console.error("[seed-scale-dataset] FAILED:", error);
  process.exit(1);
});
