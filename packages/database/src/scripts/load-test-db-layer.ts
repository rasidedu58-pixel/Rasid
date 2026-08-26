/**
 * Phase 10 — DB-layer load test.
 *
 * Honest scope note: this measures the REAL repository query functions
 * (the dominant cost in every endpoint's latency budget — JWT
 * verification is JWKS-cached and permission resolution is a handful of
 * indexed rows) directly against Postgres, under real concurrency, using
 * the SAME synthetic dataset the DB scale review used
 * (`seed-scale-dataset.ts`, run tag must already exist). It does NOT drive
 * requests through the actual HTTP/NestJS stack — minting real Supabase
 * Auth sessions for synthetic users would mean creating real `auth.users`
 * rows via the Admin API, a heavier and riskier operation than this
 * environment's Phase 10 budget justifies for a load-test harness. The
 * gap between this and true end-to-end HTTP latency is the guard chain's
 * own overhead (JWT verify + a few indexed permission-grant lookups) —
 * small relative to the query costs measured here, but NOT zero, and NOT
 * measured directly. This is recorded as a scope limitation in the Phase
 * 10 report, not papered over.
 *
 * Usage: `RUN_TAG=phase10a CONCURRENCY=20 REQUESTS=500 tsx src/scripts/load-test-db-layer.ts`
 */
import postgres from "postgres";
import { closeDb, withRuntimeContext } from "../connection";
import { getGroupReport, getMonthlyTeacherReport } from "../reports/reports.repository";
import { listSessionsWithMissingRecords } from "../reports/action-center.repository";

const RUN_TAG = process.env.RUN_TAG ?? "phase10a";
const CONCURRENCY = Number.parseInt(process.env.CONCURRENCY ?? "20", 10);
const REQUESTS = Number.parseInt(process.env.REQUESTS ?? "300", 10);

interface Timing {
  label: string;
  ms: number;
  ok: boolean;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

interface LabelStats {
  label: string;
  n: number;
  errors: number;
  p50: number;
  p95: number;
  p99: number;
  min: number | null;
  max: number | null;
}

const allStats: LabelStats[] = [];

function report(label: string, timings: Timing[]): void {
  const durations = timings.filter((t) => t.ok).map((t) => t.ms).sort((a, b) => a - b);
  const errors = timings.filter((t) => !t.ok).length;
  const p50 = percentile(durations, 50);
  const p95 = percentile(durations, 95);
  const p99 = percentile(durations, 99);
  allStats.push({
    label,
    n: timings.length,
    errors,
    p50: Math.round(p50 * 10) / 10,
    p95: Math.round(p95 * 10) / 10,
    p99: Math.round(p99 * 10) / 10,
    min: durations[0] ?? null,
    max: durations[durations.length - 1] ?? null,
  });
  console.log(
    `[${label}] n=${timings.length} errors=${errors} p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms p99=${p99.toFixed(1)}ms ` +
      `min=${durations[0]?.toFixed(1) ?? "n/a"}ms max=${durations[durations.length - 1]?.toFixed(1) ?? "n/a"}ms`,
  );
}

async function runConcurrent(label: string, count: number, concurrency: number, fn: (i: number) => Promise<void>): Promise<Timing[]> {
  const timings: Timing[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    while (next < count) {
      const i = next++;
      const start = performance.now();
      try {
        await fn(i);
        timings.push({ label, ms: performance.now() - start, ok: true });
      } catch (error) {
        timings.push({ label, ms: performance.now() - start, ok: false });
        console.error(`[${label}] request ${i} failed:`, (error as Error).message);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return timings;
}

async function main(): Promise<void> {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL is required.");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required (the report queries run through withRuntimeContext -> app_runtime, exercising real RLS, not the admin connection).");
  // The raw student-search/roster queries below use the ADMIN connection
  // directly (bypassing RLS) purely to isolate index/query-shape cost from
  // RLS/SET-LOCAL overhead — that overhead is separately negligible (a
  // session-level `SET LOCAL` plus the SAME indexed predicate) and its
  // correctness is already proven by the `*.integration.test.ts` suite,
  // not re-tested by this throughput harness. The Group/Monthly/Action-
  // Center queries below DO run through `withRuntimeContext` (real
  // app_runtime + RLS), so both cost profiles are represented.
  // `connect_timeout` — Phase 10 fix: without it, a connection-pool
  // exhaustion (this shared dev Supabase project's pooler has a real,
  // fairly low connection cap — see the Phase 10 report's own
  // ENVIRONMENT CAPACITY LIMIT note) hangs this script INDEFINITELY with
  // zero output instead of failing loudly. 10s is generous for a local
  // connection attempt; a real cap breach now surfaces as a clear error.
  const adminSql = postgres(url, { max: Math.min(CONCURRENCY + 2, 15), connect_timeout: 10 });

  const workspaces = await adminSql`SELECT id FROM workspaces WHERE name LIKE ${"SCALE-" + RUN_TAG + "%"}`;
  if (workspaces.length === 0) throw new Error(`No workspaces found for run tag "${RUN_TAG}" — run seed-scale-dataset.ts first.`);
  const workspaceIds = workspaces.map((w) => w.id as string);
  const groups = await adminSql`SELECT id, workspace_id FROM groups WHERE workspace_id = ANY(${workspaceIds})`;
  const months = await adminSql`SELECT id, workspace_id FROM operating_months WHERE workspace_id = ANY(${workspaceIds}) AND status = 'CURRENT'`;

  console.log(`[load-test-db-layer] run="${RUN_TAG}" concurrency=${CONCURRENCY} requests=${REQUESTS} workspaces=${workspaceIds.length}`);

  // 1. Student search (typed-ahead, workspace-scoped, indexed prefix filter).
  const searchTimings = await runConcurrent("student-search", REQUESTS, CONCURRENCY, async (i) => {
    const workspaceId = workspaceIds[i % workspaceIds.length]!;
    await adminSql`SELECT id, name, student_code FROM students WHERE workspace_id = ${workspaceId} AND search_name_normalized LIKE 'student%' ORDER BY name LIMIT 20`;
  });
  report("student-search", searchTimings);

  // 2. Session roster (enrollments by group_month — the Session Mode roster endpoint's own query).
  const groupMonths = await adminSql`SELECT id FROM group_months WHERE workspace_id = ANY(${workspaceIds})`;
  const rosterTimings = await runConcurrent("session-roster", REQUESTS, CONCURRENCY, async (i) => {
    const gm = groupMonths[i % groupMonths.length]!;
    await adminSql`SELECT * FROM enrollments WHERE group_month_id = ${gm.id as string} AND status = 'ACTIVE'`;
  });
  report("session-roster", rosterTimings);

  // 3. Group Report (real repository function — multi-query aggregation).
  const groupReportTimings = await runConcurrent("group-report", Math.min(REQUESTS, groups.length * 3), CONCURRENCY, async (i) => {
    const g = groups[i % groups.length]!;
    await withRuntimeContext({ workspaceId: g.workspace_id as string }, (tx) => getGroupReport(tx, g.workspace_id as string, g.id as string));
  });
  report("group-report", groupReportTimings);

  // 4. Monthly Teacher Report (workspace-wide aggregation — the heaviest read in the system).
  const monthlyReportTimings = await runConcurrent("monthly-report", Math.min(REQUESTS, months.length * 3), CONCURRENCY, async (i) => {
    const m = months[i % months.length]!;
    await withRuntimeContext({ workspaceId: m.workspace_id as string }, (tx) => getMonthlyTeacherReport(tx, m.workspace_id as string, m.id as string, "ALL"));
  });
  report("monthly-report", monthlyReportTimings);

  // 5. Action Center missing-records scan (per-workspace, current-month, cross-group aggregation).
  const actionCenterTimings = await runConcurrent("action-center-missing-records", Math.min(REQUESTS, workspaceIds.length * 3), CONCURRENCY, async (i) => {
    const workspaceId = workspaceIds[i % workspaceIds.length]!;
    await withRuntimeContext({ workspaceId }, (tx) => listSessionsWithMissingRecords(tx, workspaceId, "ALL", 10));
  });
  report("action-center-missing-records", actionCenterTimings);

  // Phase 15 fix — the Phase 14 hang, root-caused: `adminSql.end()` closed
  // the script's OWN pool, but the report/action-center sections above run
  // through `withRuntimeContext` → `getDb()`, a SEPARATE singleton pool
  // (max 10) that was never closed, keeping the event loop alive forever
  // with zero output. Close it too, emit a machine-readable JSON summary,
  // and exit explicitly so no stray handle (timer/socket) can ever wedge
  // the process again.
  await adminSql.end({ timeout: 5 });
  await closeDb();
  console.log("[load-test-db-layer] JSON_RESULT " + JSON.stringify({ runTag: RUN_TAG, concurrency: CONCURRENCY, requests: REQUESTS, stats: allStats }));
}

// Absolute safety net: if anything above still wedges (network half-open,
// pooler stall), fail LOUDLY after 10 minutes instead of hanging silently.
const watchdog = setTimeout(() => {
  console.error("[load-test-db-layer] WATCHDOG: run exceeded 10 minutes — forcing exit(2).");
  process.exit(2);
}, 10 * 60_000);
watchdog.unref();

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[load-test-db-layer] FAILED:", error);
    process.exit(1);
  });
