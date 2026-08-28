/**
 * Phase 15F — logical data dump of every public base table. SAFE +
 * READ-ONLY on the source. Emits newline-delimited JSON (one
 * `{ "table": name, "rows": [...] }` object per table) to
 * `RECOVERY_DUMP_FILE` (default ./recovery-dump.jsonl).
 *
 * Type fidelity: each table is serialized with Postgres' own `json_agg`, so
 * timestamps/uuids/jsonb/numeric all use Postgres' canonical JSON text; the
 * restore side reconstructs rows with `json_populate_recordset(null::tbl,…)`,
 * which matches columns by NAME and casts each field back to its real column
 * type. This is the drill's disposable-target backup artifact — the
 * production mechanism is Supabase's own backup / `pg_dump` (see the runbook).
 *
 * Usage: `MIGRATION_DATABASE_URL=... tsx src/scripts/recovery-dump-data.ts`
 */
import { writeFileSync } from "node:fs";
import postgres from "postgres";

async function main(): Promise<void> {
  const url = process.env.RECOVERY_SOURCE_URL ?? process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL (or RECOVERY_SOURCE_URL) is required.");
  const dumpFile = process.env.RECOVERY_DUMP_FILE ?? "./recovery-dump.jsonl";
  const sql = postgres(url, { max: 3, prepare: false });

  const tables = await sql<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE'
    ORDER BY table_name`;

  const lines: string[] = [];
  let totalRows = 0;
  for (const { table_name } of tables) {
    const [row] = await sql<{ data: unknown[] }[]>`SELECT coalesce(json_agg(t), '[]'::json) AS data FROM ${sql(table_name)} t`;
    const rows = row?.data ?? [];
    totalRows += rows.length;
    lines.push(JSON.stringify({ table: table_name, rows }));
  }

  writeFileSync(dumpFile, lines.join("\n") + "\n");
  // eslint-disable-next-line no-console
  console.log(`[recovery-dump-data] Dumped ${tables.length} tables, ${totalRows} rows -> ${dumpFile}`);
  await sql.end();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("[recovery-dump-data] FAILED:", e);
  process.exit(1);
});
