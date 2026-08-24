/**
 * Phase 10 — removes every row created by `seed-scale-dataset.ts` for one
 * `RUN_TAG`. Every seeded row's name is prefixed `SCALE-<RUN_TAG>`, so
 * cleanup is a straightforward cascade-by-workspace delete, same
 * dependency order every live integration test's own `afterAll` already
 * uses.
 *
 * Usage: `RUN_TAG=scale1 tsx src/scripts/cleanup-scale-dataset.ts`
 */
import postgres from "postgres";

async function main(): Promise<void> {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL is required.");
  const runTag = process.env.RUN_TAG;
  if (!runTag) throw new Error("RUN_TAG is required — refuses to guess which rows to delete.");

  const namePrefix = `SCALE-${runTag}%`;
  const sql = postgres(url, { max: 2 });

  const workspaceRows = await sql`SELECT id FROM workspaces WHERE name LIKE ${namePrefix}`;
  const workspaceIds = workspaceRows.map((r) => r.id as string);
  console.log(`[cleanup-scale-dataset] run="${runTag}" — found ${workspaceIds.length} workspace(s) to remove.`);

  if (workspaceIds.length > 0) {
    // Includes tables the seeder itself never writes but ad-hoc Phase 10
    // DB-scale-review enrichment (financial_obligations, outbox_events) may
    // have added on top of a given run tag — cleanup must cover EVERYTHING
    // a run could have touched, not just the seeder's own base tables.
    await sql`DELETE FROM outbox_events WHERE workspace_id = ANY(${workspaceIds})`;
    await sql`DELETE FROM audit_events WHERE workspace_id = ANY(${workspaceIds})`;
    await sql`DELETE FROM payments WHERE workspace_id = ANY(${workspaceIds})`;
    await sql`DELETE FROM financial_obligations WHERE workspace_id = ANY(${workspaceIds})`;
    await sql`DELETE FROM session_records WHERE workspace_id = ANY(${workspaceIds})`;
    await sql`DELETE FROM sessions WHERE workspace_id = ANY(${workspaceIds})`;
    await sql`DELETE FROM enrollments WHERE workspace_id = ANY(${workspaceIds})`;
    await sql`DELETE FROM students WHERE workspace_id = ANY(${workspaceIds})`;
    await sql`DELETE FROM group_months WHERE workspace_id = ANY(${workspaceIds})`;
    await sql`DELETE FROM operating_months WHERE workspace_id = ANY(${workspaceIds})`;
    await sql`DELETE FROM groups WHERE workspace_id = ANY(${workspaceIds})`;
    await sql`DELETE FROM memberships WHERE workspace_id = ANY(${workspaceIds})`;
    await sql`DELETE FROM workspaces WHERE id = ANY(${workspaceIds})`;
  }
  const userRows = await sql`DELETE FROM users WHERE full_name LIKE ${namePrefix} RETURNING id`;
  console.log(`[cleanup-scale-dataset] removed ${workspaceIds.length} workspace(s), ${userRows.length} user(s).`);

  await sql.end();
}

main().catch((error) => {
  console.error("[cleanup-scale-dataset] FAILED:", error);
  process.exit(1);
});
