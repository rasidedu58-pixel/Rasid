/**
 * Phase 10 Closure Delta — focused, reproducible before/after benchmark for
 * Group Report / Monthly Teacher Report specifically (the two queries that
 * FAILED the Phase 10 load-test SLO). Deliberately narrow and simple (no
 * concurrency harness, no connection-pool scaffolding) so it cannot itself
 * introduce the kind of hang the broader load-test script did — this
 * measures pure sequential per-call latency against the SAME phase10b
 * synthetic dataset used by the Phase 10 scale review.
 *
 * Usage: `RUN_TAG=phase10b N=30 tsx src/scripts/bench-reports.ts`
 */
import postgres from "postgres";
import { withRuntimeContext } from "../connection";
import { getGroupReport, getMonthlyTeacherReport } from "../reports/reports.repository";

const RUN_TAG = process.env.RUN_TAG ?? "phase10b";
const N = Number.parseInt(process.env.N ?? "30", 10);

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

function report(label: string, durations: number[]): void {
  const sorted = [...durations].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  console.log(`[${label}] n=${durations.length} p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms p99=${p99.toFixed(1)}ms min=${sorted[0]?.toFixed(1)}ms max=${sorted[sorted.length - 1]?.toFixed(1)}ms`);
}

async function main(): Promise<void> {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL is required.");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const adminSql = postgres(url, { max: 2, connect_timeout: 10 });

  const groups = await adminSql`
    SELECT g.id, g.workspace_id FROM groups g
    JOIN workspaces w ON w.id = g.workspace_id
    WHERE w.name LIKE ${"SCALE-" + RUN_TAG + "%"}
    LIMIT ${N}
  `;
  const months = await adminSql`
    SELECT m.id, m.workspace_id FROM operating_months m
    JOIN workspaces w ON w.id = m.workspace_id
    WHERE w.name LIKE ${"SCALE-" + RUN_TAG + "%"} AND m.status = 'CURRENT'
    LIMIT ${N}
  `;
  if (groups.length === 0 || months.length === 0) throw new Error(`No data found for run tag "${RUN_TAG}" — run seed-scale-dataset.ts first.`);
  console.log(`[bench-reports] run="${RUN_TAG}" groups=${groups.length} months=${months.length}`);

  const groupDurations: number[] = [];
  for (const g of groups) {
    const start = performance.now();
    await withRuntimeContext({ workspaceId: g.workspace_id as string }, (tx) => getGroupReport(tx, g.workspace_id as string, g.id as string));
    groupDurations.push(performance.now() - start);
  }
  report("group-report", groupDurations);

  const monthlyDurations: number[] = [];
  for (const m of months) {
    const start = performance.now();
    await withRuntimeContext({ workspaceId: m.workspace_id as string }, (tx) => getMonthlyTeacherReport(tx, m.workspace_id as string, m.id as string, "ALL"));
    monthlyDurations.push(performance.now() - start);
  }
  report("monthly-report", monthlyDurations);

  await adminSql.end();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[bench-reports] FAILED:", error);
    process.exit(1);
  });
