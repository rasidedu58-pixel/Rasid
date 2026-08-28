/**
 * Phase 15F — verifies a RESTORED target against the pre-restore manifest
 * (§8–§9). SAFE + READ-ONLY. Rebuilds the schema baseline + fixture state
 * from the target using the SAME queries the capture used, then deep-compares
 * to the manifest. Finance is compared as exact integer minor-unit strings,
 * never a rendered total. Prints a check matrix and exits non-zero on ANY
 * mismatch — so it genuinely fails on corruption (proven in §14), never just
 * always-passes.
 *
 * Usage: `RECOVERY_TARGET_URL=... RECOVERY_MANIFEST_FILE=... tsx src/scripts/recovery-verify-manifest.ts`
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { buildFixtureState, captureBaseline, BASELINE_TABLES, type Baseline, type FixtureState } from "./recovery-shared";

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

function eq(name: string, expected: unknown, actual: unknown, checks: Check[]): void {
  const e = JSON.stringify(expected);
  const a = JSON.stringify(actual);
  checks.push({ name, ok: e === a, detail: e === a ? undefined : `expected ${e} got ${a}` });
}

async function main(): Promise<void> {
  const url = process.env.RECOVERY_TARGET_URL;
  if (!url) throw new Error("RECOVERY_TARGET_URL is required (the restored disposable target).");
  const manifestFile = process.env.RECOVERY_MANIFEST_FILE ?? "./recovery-manifest.json";
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as { workspaceId: string; baseline: Baseline; fixture: FixtureState };

  const sql = postgres(url, { max: 3, prepare: false });
  const baseline = await captureBaseline(sql);
  const fixture = await buildFixtureState(sql, manifest.workspaceId);
  await sql.end();

  const checks: Check[] = [];

  // --- Schema + global data integrity (every launch-critical table's count) ---
  for (const t of BASELINE_TABLES) {
    eq(`baseline.count.${t}`, manifest.baseline.tableCounts[t], baseline.tableCounts[t], checks);
  }
  eq("baseline.rlsEnabledTables", manifest.baseline.rlsEnabledTables, baseline.rlsEnabledTables, checks);
  eq("baseline.rlsPolicies", manifest.baseline.rlsPolicies, baseline.rlsPolicies, checks);
  eq("baseline.enumTypes", manifest.baseline.enumTypes, baseline.enumTypes, checks);
  eq("baseline.triggers", manifest.baseline.triggers, baseline.triggers, checks);
  eq("baseline.indexes", manifest.baseline.indexes, baseline.indexes, checks);

  // --- Identity / membership / scope ---
  const m = manifest.fixture;
  eq("workspace", m.workspace, fixture.workspace, checks);
  eq("memberships", m.memberships, fixture.memberships, checks);

  // --- Students / roster ---
  eq("students", m.students, fixture.students, checks);
  eq("group", m.group, fixture.group, checks);
  eq("month", m.month, fixture.month, checks);
  eq("enrollments", m.enrollments, fixture.enrollments, checks);

  // --- Session history ---
  eq("sessions", m.sessions, fixture.sessions, checks);
  eq("sessionRecords", m.sessionRecords, fixture.sessionRecords, checks);

  // --- Finance (exact minor units + immutable payment/reversal history) ---
  eq("finance.rows", m.finance, fixture.finance, checks);
  eq("finance.totals", m.financeTotals, fixture.financeTotals, checks);

  // --- Attention / follow-up / notifications / outbox ---
  eq("attention", m.attention, fixture.attention, checks);
  eq("followups", m.followups, fixture.followups, checks);
  eq("contactLogs", m.contactLogs, fixture.contactLogs, checks);
  eq("notifications", m.notifications, fixture.notifications, checks);
  eq("outboxEvents", m.outboxEvents, fixture.outboxEvents, checks);

  const failed = checks.filter((c) => !c.ok);
  // eslint-disable-next-line no-console
  console.log(`\n=== RECOVERY VERIFICATION (${checks.length} checks) ===`);
  for (const c of checks) {
    // eslint-disable-next-line no-console
    if (!c.ok) console.log(`  ✗ ${c.name}: ${c.detail}`);
  }
  // eslint-disable-next-line no-console
  console.log(failed.length === 0 ? `ALL ${checks.length} CHECKS PASSED ✓` : `${failed.length}/${checks.length} CHECKS FAILED ✗`);

  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("[recovery-verify-manifest] FAILED:", e);
  process.exit(2);
});
