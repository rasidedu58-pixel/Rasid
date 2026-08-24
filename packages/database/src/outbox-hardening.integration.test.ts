/**
 * Phase 10 — Outbox hardening (bounded retry / terminal DEAD status / no
 * starvation / operator replay) real-Postgres integration tests.
 *
 * Mirrors every other `*.integration.test.ts` in this package: two real
 * connections (`MIGRATION_DATABASE_URL` admin / `WORKER_DATABASE_URL`
 * app_worker), self-skips without live credentials + a prior build.
 *
 * A genuinely "poison" event is manufactured deterministically: a
 * `SessionCompleted` event whose payload `sessionId` is NOT a valid UUID —
 * `runEvaluateAttentionRulesForSessionTransaction`'s own
 * `eq(sessions.id, input.sessionId)` then raises a real Postgres
 * `invalid input syntax for type uuid` error every single time, with no
 * possible automatic recovery — exactly the "permanently invalid event"
 * scenario Phase 10 asks to prove bounded.
 *
 * To avoid the test taking ~10 real backoff cycles (up to the 10-minute
 * cap each), intermediate `attempt_count`/`available_at` values are
 * fast-forwarded directly via admin SQL between calls — the FIRST
 * transition (attempt 0 -> FAILED) and the LAST (attempt 9 -> DEAD) are
 * still exercised through the real `processPendingOutboxEvents` code path,
 * proving the actual boundary condition, not just the arithmetic.
 *
 * Requires migrations 0001-0045 to already be applied against the target
 * database.
 */
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getWorkerDb, processPendingOutboxEvents, replayDeadOutboxEvent } from "@academic-precision/database";

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const WORKER_DATABASE_URL = process.env.WORKER_DATABASE_URL;

const distEntryPoint = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const distBuilt = existsSync(distEntryPoint);

const hasLiveCreds =
  !!DATABASE_URL && !!MIGRATION_DATABASE_URL && !!WORKER_DATABASE_URL && DATABASE_URL !== MIGRATION_DATABASE_URL && distBuilt;

if (!hasLiveCreds) {
  // eslint-disable-next-line no-console
  console.warn(
    "[outbox-hardening.integration.test] Skipping: requires DATABASE_URL, MIGRATION_DATABASE_URL, AND " +
      "WORKER_DATABASE_URL (app_worker role, LOGIN enabled), AND this package already built " +
      "(`pnpm build` — dist/index.js must exist). Expected to skip in CI / sandboxes without live " +
      "Supabase credentials, and in a pre-build test run — this is not a failure.",
  );
}

describe.skipIf(!hasLiveCreds)("Phase 10 Outbox Hardening (live Postgres)", () => {
  let admin: Sql;
  const workspaceId = randomUUID();
  const userId = randomUUID();
  const groupId = randomUUID();
  const monthId = randomUUID();
  const groupMonthId = randomUUID();
  const healthySessionId = randomUUID();
  const poisonEventId = randomUUID();
  const healthyEventId = randomUUID();
  const MAX_ATTEMPTS = 10;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    admin = postgres(MIGRATION_DATABASE_URL!, { max: 2 });

    await admin`INSERT INTO users (id, full_name, email_display, status) VALUES (${userId}, 'Outbox Hardening Test User', 'outbox-hardening-test@example.test', 'ACTIVE')`;
    await admin`INSERT INTO workspaces (id, owner_user_id, name, workspace_type, locale, timezone, due_date_policy, status) VALUES
      (${workspaceId}, ${userId}, 'Outbox Hardening Test Workspace', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE')`;
    await admin`INSERT INTO groups (id, workspace_id, name, status) VALUES (${groupId}, ${workspaceId}, 'Outbox Hardening Test Group', 'ACTIVE')`;
    await admin`INSERT INTO operating_months (id, workspace_id, year, month, status, created_by) VALUES (${monthId}, ${workspaceId}, 2026, 8, 'CURRENT', ${userId})`;
    await admin`INSERT INTO group_months (id, workspace_id, group_id, operating_month_id, base_fee_minor, due_policy, join_fee_policy)
      VALUES (${groupMonthId}, ${workspaceId}, ${groupId}, ${monthId}, 30000, 'PER_GROUP', 'FULL')`;
    // A real, healthy session with no records — evaluation succeeds trivially (0 students to evaluate).
    await admin`INSERT INTO sessions (id, workspace_id, group_month_id, scheduled_at, duration_minutes, status, origin, created_by) VALUES
      (${healthySessionId}, ${workspaceId}, ${groupMonthId}, '2026-08-05T08:00:00Z', 60, 'COMPLETED', 'GENERATED', ${userId})`;
  });

  afterAll(async () => {
    try {
      await admin`DELETE FROM outbox_events WHERE workspace_id = ${workspaceId}`;
      await admin`DELETE FROM audit_events WHERE workspace_id = ${workspaceId}`;
      await admin`DELETE FROM sessions WHERE workspace_id = ${workspaceId}`;
      await admin`DELETE FROM group_months WHERE workspace_id = ${workspaceId}`;
      await admin`DELETE FROM operating_months WHERE workspace_id = ${workspaceId}`;
      await admin`DELETE FROM groups WHERE workspace_id = ${workspaceId}`;
      await admin`DELETE FROM workspaces WHERE id = ${workspaceId}`;
      await admin`DELETE FROM users WHERE id = ${userId}`;
    } finally {
      await admin.end({ timeout: 5 });
      await closeDb();
    }
  });

  it("attempt 1: a poison event (invalid sessionId) fails cleanly and is scheduled for backoff retry, not DEAD yet", async () => {
    await admin`INSERT INTO outbox_events (id, workspace_id, event_type, aggregate_type, aggregate_id, payload, status) VALUES
      (${poisonEventId}, ${workspaceId}, 'SessionCompleted', 'Session', ${randomUUID()}, ${JSON.stringify({ sessionId: "not-a-valid-uuid" })}::jsonb, 'PENDING')`;

    const workerDb = getWorkerDb();
    const result = await processPendingOutboxEvents(workerDb, { eventTypes: ["SessionCompleted"], maxEvents: 1 });
    expect(result.claimed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.dead).toBe(0);

    const row = await admin`SELECT status, attempt_count, available_at, last_error FROM outbox_events WHERE id = ${poisonEventId}`;
    expect(row[0]!.status).toBe("FAILED");
    expect(row[0]!.attempt_count).toBe(1);
    expect(new Date(row[0]!.available_at as string).getTime()).toBeGreaterThan(Date.now()); // backed off into the future
    expect(row[0]!.last_error).toBeTruthy();
  });

  it("no starvation: a HEALTHY due event is processed in the same cycle even though the poison event still exists (just not due yet)", async () => {
    await admin`INSERT INTO outbox_events (id, workspace_id, event_type, aggregate_type, aggregate_id, payload, status) VALUES
      (${healthyEventId}, ${workspaceId}, 'SessionCompleted', 'Session', ${healthySessionId}, ${JSON.stringify({ sessionId: healthySessionId })}::jsonb, 'PENDING')`;

    const workerDb = getWorkerDb();
    const result = await processPendingOutboxEvents(workerDb, { eventTypes: ["SessionCompleted"], maxEvents: 5 });
    expect(result.claimed).toBe(1); // ONLY the healthy one — poison isn't due
    expect(result.processed).toBe(1);

    const row = await admin`SELECT status FROM outbox_events WHERE id = ${healthyEventId}`;
    expect(row[0]!.status).toBe("PROCESSED");
  });

  it("fast-forward to the last attempt, then prove the exact MAX_ATTEMPTS boundary: attempt 10 goes DEAD, not FAILED-and-retried again", async () => {
    // Fast-forward: pretend this event has already failed 9 times and is due right now — skips real backoff wall-clock time without skipping the CODE PATH under test (the transition AT the boundary still runs for real).
    await admin`UPDATE outbox_events SET attempt_count = ${MAX_ATTEMPTS - 1}, available_at = now() WHERE id = ${poisonEventId}`;

    const workerDb = getWorkerDb();
    const result = await processPendingOutboxEvents(workerDb, { eventTypes: ["SessionCompleted"], maxEvents: 1 });
    expect(result.claimed).toBe(1);
    expect(result.dead).toBe(1);

    const row = await admin`SELECT status, attempt_count FROM outbox_events WHERE id = ${poisonEventId}`;
    expect(row[0]!.status).toBe("DEAD");
    expect(row[0]!.attempt_count).toBe(MAX_ATTEMPTS);
  });

  it("a DEAD event is NEVER claimed again by the normal poll loop — not even once", async () => {
    const workerDb = getWorkerDb();
    const result = await processPendingOutboxEvents(workerDb, { eventTypes: ["SessionCompleted"], maxEvents: 5 });
    expect(result.claimed).toBe(0); // nothing eligible — the DEAD row is correctly excluded
  });

  it("operator replay: replayDeadOutboxEvent resets a DEAD event to PENDING/attempt_count=0, making it claimable again", async () => {
    const workerDb = getWorkerDb();
    const replayed = await replayDeadOutboxEvent(workerDb, poisonEventId);
    expect(replayed).toBeDefined();
    expect(replayed!.status).toBe("PENDING");
    expect(replayed!.attemptCount).toBe(0);

    // Replaying a row that is NOT currently DEAD is a safe no-op (returns undefined) — never silently "revives" an already-healthy row.
    const notDead = await replayDeadOutboxEvent(workerDb, healthyEventId); // this one is PROCESSED, not DEAD
    expect(notDead).toBeUndefined();

    // Confirm it is genuinely claimable again (still poison, so it fails again — attempt_count climbs from 0, not from where it left off).
    const result = await processPendingOutboxEvents(workerDb, { eventTypes: ["SessionCompleted"], maxEvents: 1 });
    expect(result.claimed).toBe(1);
    const row = await admin`SELECT status, attempt_count FROM outbox_events WHERE id = ${poisonEventId}`;
    expect(row[0]!.status).toBe("FAILED");
    expect(row[0]!.attempt_count).toBe(1);
  });
});
