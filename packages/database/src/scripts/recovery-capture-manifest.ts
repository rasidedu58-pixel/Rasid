/**
 * Phase 15F — captures the pre-restore "expected recovery state" manifest
 * from the live source (§4). SAFE + READ-ONLY. Reads the tagged fixture's
 * workspace id from `RECOVERY_IDS_FILE` and writes a machine-checkable
 * manifest (schema baseline + exact fixture domain state incl. finance in
 * integer minor units) to `RECOVERY_MANIFEST_FILE` (default ./recovery-manifest.json).
 *
 * Usage: `MIGRATION_DATABASE_URL=... tsx src/scripts/recovery-capture-manifest.ts`
 */
import { readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { buildFixtureState, captureBaseline } from "./recovery-shared";

async function main(): Promise<void> {
  const url = process.env.RECOVERY_SOURCE_URL ?? process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL (or RECOVERY_SOURCE_URL) is required.");
  const idsFile = process.env.RECOVERY_IDS_FILE ?? "./recovery-fixture-ids.json";
  const manifestFile = process.env.RECOVERY_MANIFEST_FILE ?? "./recovery-manifest.json";

  const { workspaceId } = JSON.parse(readFileSync(idsFile, "utf8")) as { workspaceId: string };
  const sql = postgres(url, { max: 3, prepare: false });

  const baseline = await captureBaseline(sql);
  const fixture = await buildFixtureState(sql, workspaceId);

  const manifest = { capturedFrom: baseline.postgresVersion, workspaceId, baseline, fixture };
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  // eslint-disable-next-line no-console
  console.log(`[recovery-capture-manifest] Captured baseline (${Object.keys(baseline.tableCounts).length} tables) + fixture -> ${manifestFile}`);
  await sql.end();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("[recovery-capture-manifest] FAILED:", e);
  process.exit(1);
});
