/**
 * Phase 15F — removes the RECOVERY_DRILL fixture from a database, in FK
 * dependency order, scoped to the tagged workspace(s). Safe to run against
 * the source (to clean staging after the drill) or a disposable target.
 * Resolves the workspace id from `RECOVERY_IDS_FILE` when present, else falls
 * back to matching workspaces named `RECOVERY_DRILL::%` — so it always finds
 * the exact fixture and never touches the standing QA data.
 *
 * Usage: `MIGRATION_DATABASE_URL=... tsx src/scripts/recovery-cleanup-fixture.ts`
 */
import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";

async function main(): Promise<void> {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL is required.");
  const idsFile = process.env.RECOVERY_IDS_FILE ?? "./recovery-fixture-ids.json";
  const sql = postgres(url, { max: 2 });

  let workspaceIds: string[] = [];
  if (existsSync(idsFile)) {
    const parsed = JSON.parse(readFileSync(idsFile, "utf8")) as { workspaceId?: string };
    if (parsed.workspaceId) workspaceIds = [parsed.workspaceId];
  }
  if (workspaceIds.length === 0) {
    const rows = await sql<{ id: string }[]>`SELECT id FROM workspaces WHERE name LIKE 'RECOVERY_DRILL::%'`;
    workspaceIds = rows.map((r) => r.id);
  }

  if (workspaceIds.length === 0) {
    // eslint-disable-next-line no-console
    console.log("[recovery-cleanup-fixture] Nothing to remove.");
    await sql.end();
    return;
  }

  const ws = workspaceIds;
  await sql.begin(async (tx) => {
    // Child-first FK order.
    await tx`DELETE FROM payment_reversals WHERE workspace_id = ANY(${ws})`;
    await tx`DELETE FROM payments WHERE workspace_id = ANY(${ws})`;
    await tx`DELETE FROM financial_obligations WHERE workspace_id = ANY(${ws})`;
    await tx`DELETE FROM attention_evidence WHERE workspace_id = ANY(${ws})`;
    await tx`DELETE FROM attention_reasons WHERE workspace_id = ANY(${ws})`;
    await tx`DELETE FROM scheduled_followups WHERE workspace_id = ANY(${ws})`;
    await tx`DELETE FROM contact_logs WHERE workspace_id = ANY(${ws})`;
    await tx`DELETE FROM attention_cases WHERE workspace_id = ANY(${ws})`;
    await tx`DELETE FROM session_records WHERE workspace_id = ANY(${ws})`;
    await tx`DELETE FROM session_exams WHERE workspace_id = ANY(${ws})`;
    await tx`DELETE FROM sessions WHERE workspace_id = ANY(${ws})`;
    await tx`DELETE FROM enrollments WHERE workspace_id = ANY(${ws})`;
    await tx`DELETE FROM student_guardians WHERE workspace_id = ANY(${ws})`;
    await tx`DELETE FROM guardians WHERE workspace_id = ANY(${ws})`;
    await tx`DELETE FROM group_months WHERE workspace_id = ANY(${ws})`;
    await tx`DELETE FROM operating_months WHERE workspace_id = ANY(${ws})`;
    await tx`DELETE FROM groups WHERE workspace_id = ANY(${ws})`;
    await tx`DELETE FROM students WHERE workspace_id = ANY(${ws})`;
    await tx`DELETE FROM notifications WHERE workspace_id = ANY(${ws})`;
    await tx`DELETE FROM outbox_events WHERE workspace_id = ANY(${ws})`;
    await tx`DELETE FROM audit_events WHERE workspace_id = ANY(${ws})`;
    await tx`DELETE FROM memberships WHERE workspace_id = ANY(${ws})`;
    const owners = await tx<{ owner_user_id: string }[]>`SELECT owner_user_id FROM workspaces WHERE id = ANY(${ws})`;
    await tx`DELETE FROM workspaces WHERE id = ANY(${ws})`;
    // Fixture users (owner + assistant) are only ever referenced by this fixture.
    await tx`DELETE FROM users WHERE email_display IN ('recovery-owner@example.test', 'recovery-assistant@example.test')`;
    void owners;
  });

  // eslint-disable-next-line no-console
  console.log(`[recovery-cleanup-fixture] Removed ${ws.length} RECOVERY_DRILL workspace(s).`);
  await sql.end();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("[recovery-cleanup-fixture] FAILED:", e);
  process.exit(1);
});
