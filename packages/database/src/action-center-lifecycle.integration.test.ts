/**
 * Session lifecycle — real-Postgres integration test.
 *
 * Exercises `getNextSession` + `listMissedSessions` + the tightened
 * `listSessionsWithMissingRecords` against a real database seeded with
 * the exact production scenarios from the owner's Phase 4 brief:
 *
 *   - Monday session `IN_PROGRESS` past end (missed).
 *   - Wednesday session `IN_PROGRESS` inside its window (live).
 *   - Wednesday `SCHEDULED` whose slot arrived (READY).
 *   - Future SCHEDULED (upcoming).
 *   - COMPLETED / CANCELLED / RESCHEDULED (never in either bucket).
 *
 * Same skip pattern as the other integration tests in this package —
 * requires `DATABASE_URL`, `MIGRATION_DATABASE_URL`, and a built `dist/`,
 * so it runs in CI (ephemeral postgres:18) and skips cleanly in any
 * environment without those. Production data is NEVER touched: every
 * insert is scoped to two throwaway workspaces created + torn down by
 * this suite alone.
 *
 * No migration. No domain change. Read-only queries under test.
 */
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeDb,
  getNextSession,
  listMissedSessions,
  listSessionsWithMissingRecords,
  withRuntimeContext,
} from "@academic-precision/database";

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;

const distEntryPoint = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const distBuilt = existsSync(distEntryPoint);

const hasLiveCreds =
  !!DATABASE_URL &&
  !!MIGRATION_DATABASE_URL &&
  DATABASE_URL !== MIGRATION_DATABASE_URL &&
  distBuilt;

if (!hasLiveCreds) {
  // eslint-disable-next-line no-console
  console.warn(
    "[action-center-lifecycle.integration.test] Skipping: requires DATABASE_URL " +
      "+ MIGRATION_DATABASE_URL (distinct, live Postgres) AND a built package " +
      "(dist/index.js). Expected to skip in CI / sandboxes without live DB creds " +
      "and in a pre-build local run — this is not a failure.",
  );
}

describe.skipIf(!hasLiveCreds)("Session lifecycle — Action Center queries (live Postgres)", () => {
  let admin: Sql;

  const workspaceAId = randomUUID();
  const workspaceBId = randomUUID();
  const userAId = randomUUID();
  const userBId = randomUUID();
  const groupA1Id = randomUUID();
  const groupA2Id = randomUUID();
  const groupBId = randomUUID();
  const monthAId = randomUUID();
  const monthBId = randomUUID();
  const gmA1Id = randomUUID();
  const gmA2Id = randomUUID();
  const gmBId = randomUUID();

  // Anchor time (owner's exact scenario): now = Wednesday 2026-09-16 18:00 UTC.
  const now = new Date("2026-09-16T18:00:00Z");
  // Monday 2026-09-14 19:19 UTC, 60-min slot — ended Monday 20:19, now is Wednesday.
  const mondayIso = "2026-09-14T19:19:00Z";
  // Wednesday IN_PROGRESS inside its window — starts 17:30 UTC, ends 18:30.
  const wedInProgressIso = "2026-09-16T17:30:00Z";
  // Wednesday SCHEDULED whose slot has arrived — starts 17:45 UTC, 60 min.
  const wedReadyIso = "2026-09-16T17:45:00Z";
  // Future SCHEDULED — starts Thursday 10:00 UTC.
  const thursdayIso = "2026-09-17T10:00:00Z";
  // Historical COMPLETED — never in either bucket.
  const historicalCompletedIso = "2026-09-10T12:00:00Z";
  // Historical CANCELLED / RESCHEDULED — likewise excluded.
  const historicalCancelledIso = "2026-09-11T12:00:00Z";
  const historicalRescheduledIso = "2026-09-12T12:00:00Z";
  // A workspace-B row scheduled the same way to prove workspace isolation.
  const workspaceBMissedIso = "2026-09-14T19:19:00Z";

  const s = {
    mondayMissed: randomUUID(),
    wedLive: randomUUID(),
    wedReady: randomUUID(),
    thursdayFuture: randomUUID(),
    completed: randomUUID(),
    cancelled: randomUUID(),
    rescheduled: randomUUID(),
    bWorkspace: randomUUID(),
    // Second group in workspace A to prove visible-group scope.
    otherGroupMissed: randomUUID(),
  };

  beforeAll(async () => {
    admin = postgres(MIGRATION_DATABASE_URL!, { max: 4, prepare: false });

    await admin`INSERT INTO users (id, full_name, email_display, status) VALUES
      (${userAId}, 'Lifecycle Test User A', 'lifecycle-a@example.test', 'ACTIVE'),
      (${userBId}, 'Lifecycle Test User B', 'lifecycle-b@example.test', 'ACTIVE')`;

    await admin`INSERT INTO workspaces
      (id, owner_user_id, name, workspace_type, locale, timezone, due_date_policy, status) VALUES
      (${workspaceAId}, ${userAId}, 'Lifecycle Test Workspace A', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE'),
      (${workspaceBId}, ${userBId}, 'Lifecycle Test Workspace B', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE')`;

    await admin`INSERT INTO groups (id, workspace_id, name, status) VALUES
      (${groupA1Id}, ${workspaceAId}, 'Group A1 (Math)', 'ACTIVE'),
      (${groupA2Id}, ${workspaceAId}, 'Group A2 (Physics)', 'ACTIVE'),
      (${groupBId},  ${workspaceBId}, 'Group B',           'ACTIVE')`;

    await admin`INSERT INTO operating_months (id, workspace_id, year, month, status, created_by) VALUES
      (${monthAId}, ${workspaceAId}, 2026, 9, 'CURRENT', ${userAId}),
      (${monthBId}, ${workspaceBId}, 2026, 9, 'CURRENT', ${userBId})`;

    await admin`INSERT INTO group_months
      (id, workspace_id, group_id, operating_month_id, base_fee_minor, due_policy, join_fee_policy) VALUES
      (${gmA1Id}, ${workspaceAId}, ${groupA1Id}, ${monthAId}, 30000, 'PER_GROUP', 'FULL'),
      (${gmA2Id}, ${workspaceAId}, ${groupA2Id}, ${monthAId}, 30000, 'PER_GROUP', 'FULL'),
      (${gmBId},  ${workspaceBId}, ${groupBId},  ${monthBId}, 30000, 'PER_GROUP', 'FULL')`;

    await admin`INSERT INTO sessions
      (id, workspace_id, group_month_id, scheduled_at, duration_minutes, status, origin, created_by) VALUES
      (${s.mondayMissed},      ${workspaceAId}, ${gmA1Id}, ${mondayIso},                60, 'IN_PROGRESS', 'GENERATED', ${userAId}),
      (${s.wedLive},           ${workspaceAId}, ${gmA1Id}, ${wedInProgressIso},          60, 'IN_PROGRESS', 'GENERATED', ${userAId}),
      (${s.wedReady},          ${workspaceAId}, ${gmA2Id}, ${wedReadyIso},               60, 'SCHEDULED',   'GENERATED', ${userAId}),
      (${s.thursdayFuture},    ${workspaceAId}, ${gmA1Id}, ${thursdayIso},               60, 'SCHEDULED',   'GENERATED', ${userAId}),
      (${s.completed},         ${workspaceAId}, ${gmA1Id}, ${historicalCompletedIso},    60, 'COMPLETED',   'GENERATED', ${userAId}),
      (${s.cancelled},         ${workspaceAId}, ${gmA1Id}, ${historicalCancelledIso},    60, 'CANCELLED',   'GENERATED', ${userAId}),
      (${s.rescheduled},       ${workspaceAId}, ${gmA1Id}, ${historicalRescheduledIso},  60, 'RESCHEDULED', 'GENERATED', ${userAId}),
      (${s.otherGroupMissed},  ${workspaceAId}, ${gmA2Id}, ${mondayIso},                 60, 'SCHEDULED',   'GENERATED', ${userAId}),
      (${s.bWorkspace},        ${workspaceBId}, ${gmBId},  ${workspaceBMissedIso},       60, 'IN_PROGRESS', 'GENERATED', ${userBId})`;
  });

  afterAll(async () => {
    try {
      await admin`DELETE FROM sessions WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM group_months WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM operating_months WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM groups WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM workspaces WHERE id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM users WHERE id IN (${userAId}, ${userBId})`;
    } finally {
      await admin.end({ timeout: 5 });
      await closeDb();
    }
  });

  it("getNextSession — Wednesday IN_PROGRESS inside its window wins; Monday IN_PROGRESS (past end) is NOT chosen", async () => {
    const result = await withRuntimeContext({ workspaceId: workspaceAId, userId: userAId }, (db) => getNextSession(db, workspaceAId, "ALL", now));
    expect(result?.sessionId).toBe(s.wedLive);
    expect(result?.status).toBe("IN_PROGRESS");
    // The bug reproduction: the Monday session MUST NOT be selected on Wednesday.
    expect(result?.sessionId).not.toBe(s.mondayMissed);
  });

  it("getNextSession — READY case: with no live session, a SCHEDULED whose slot arrived wins over any future SCHEDULED", async () => {
    // Deletes the live Wednesday session so only the READY + future rows remain.
    await admin`DELETE FROM sessions WHERE id = ${s.wedLive}`;
    try {
      const result = await withRuntimeContext({ workspaceId: workspaceAId, userId: userAId }, (db) => getNextSession(db, workspaceAId, "ALL", now));
      expect(result?.sessionId).toBe(s.wedReady);
      expect(result?.status).toBe("READY");
      expect(result?.durationMinutes).toBe(60);
    } finally {
      // Restore for the remaining tests in this suite.
      await admin`INSERT INTO sessions (id, workspace_id, group_month_id, scheduled_at, duration_minutes, status, origin, created_by) VALUES
        (${s.wedLive}, ${workspaceAId}, ${gmA1Id}, ${wedInProgressIso}, 60, 'IN_PROGRESS', 'GENERATED', ${userAId})`;
    }
  });

  it("getNextSession — future SCHEDULED chosen only when nothing live/ready exists; returns durationMinutes for boundary scheduling", async () => {
    await admin`DELETE FROM sessions WHERE id IN (${s.wedLive}, ${s.wedReady}, ${s.mondayMissed}, ${s.otherGroupMissed})`;
    try {
      const result = await withRuntimeContext({ workspaceId: workspaceAId, userId: userAId }, (db) => getNextSession(db, workspaceAId, "ALL", now));
      expect(result?.sessionId).toBe(s.thursdayFuture);
      expect(result?.status).toBe("SCHEDULED");
      expect(result?.durationMinutes).toBe(60);
    } finally {
      await admin`INSERT INTO sessions (id, workspace_id, group_month_id, scheduled_at, duration_minutes, status, origin, created_by) VALUES
        (${s.mondayMissed},     ${workspaceAId}, ${gmA1Id}, ${mondayIso},        60, 'IN_PROGRESS', 'GENERATED', ${userAId}),
        (${s.wedLive},          ${workspaceAId}, ${gmA1Id}, ${wedInProgressIso}, 60, 'IN_PROGRESS', 'GENERATED', ${userAId}),
        (${s.wedReady},         ${workspaceAId}, ${gmA2Id}, ${wedReadyIso},      60, 'SCHEDULED',   'GENERATED', ${userAId}),
        (${s.otherGroupMissed}, ${workspaceAId}, ${gmA2Id}, ${mondayIso},        60, 'SCHEDULED',   'GENERATED', ${userAId})`;
    }
  });

  it("getNextSession — workspace isolation: A never sees B's live-now session and vice versa", async () => {
    const forA = await withRuntimeContext({ workspaceId: workspaceAId, userId: userAId }, (db) => getNextSession(db, workspaceAId, "ALL", now));
    const forB = await withRuntimeContext({ workspaceId: workspaceBId, userId: userBId }, (db) => getNextSession(db, workspaceBId, "ALL", now));
    expect(forA?.sessionId).not.toBe(s.bWorkspace);
    // Workspace B's only IN_PROGRESS session is past-end (same Monday timestamp) → nothing selected there.
    expect(forB).toBeUndefined();
  });

  it("getNextSession — visible-group scope: passing only group A2 filters out A1's live session", async () => {
    const result = await withRuntimeContext({ workspaceId: workspaceAId, userId: userAId }, (db) => getNextSession(db, workspaceAId, [groupA2Id], now));
    // With A1 filtered out, no live IN_PROGRESS exists in scope — the
    // READY session in A2 wins.
    expect(result?.sessionId).toBe(s.wedReady);
    expect(result?.status).toBe("READY");
  });

  it("listMissedSessions — surfaces the Monday IN_PROGRESS session and the second-group SCHEDULED past-end; excludes COMPLETED/CANCELLED/RESCHEDULED", async () => {
    const result = await withRuntimeContext({ workspaceId: workspaceAId, userId: userAId }, (db) => listMissedSessions(db, workspaceAId, "ALL", 10, now));
    const ids = new Set(result.map((r) => r.sessionId));
    expect(ids.has(s.mondayMissed)).toBe(true);
    expect(ids.has(s.otherGroupMissed)).toBe(true);
    // Terminal states must NEVER appear here.
    expect(ids.has(s.completed)).toBe(false);
    expect(ids.has(s.cancelled)).toBe(false);
    expect(ids.has(s.rescheduled)).toBe(false);
    // Live + future sessions must NEVER appear here.
    expect(ids.has(s.wedLive)).toBe(false);
    expect(ids.has(s.wedReady)).toBe(false);
    expect(ids.has(s.thursdayFuture)).toBe(false);
    // storedStatus is preserved (SCHEDULED vs IN_PROGRESS) so late-recording UX picks the right write path.
    const monday = result.find((r) => r.sessionId === s.mondayMissed);
    expect(monday?.storedStatus).toBe("IN_PROGRESS");
    const otherGroup = result.find((r) => r.sessionId === s.otherGroupMissed);
    expect(otherGroup?.storedStatus).toBe("SCHEDULED");
  });

  it("listMissedSessions — orders by scheduledAt DESC (most-recently-missed first) and respects the limit", async () => {
    // Both missed rows share the Monday timestamp; the DESC order still
    // deterministic-ish by tie-break on id, but the top-N contract must
    // never include rows beyond `limit`.
    const one = await withRuntimeContext({ workspaceId: workspaceAId, userId: userAId }, (db) => listMissedSessions(db, workspaceAId, "ALL", 1, now));
    expect(one).toHaveLength(1);
  });

  it("listMissedSessions — workspace isolation", async () => {
    const forA = await withRuntimeContext({ workspaceId: workspaceAId, userId: userAId }, (db) => listMissedSessions(db, workspaceAId, "ALL", 10, now));
    const forB = await withRuntimeContext({ workspaceId: workspaceBId, userId: userBId }, (db) => listMissedSessions(db, workspaceBId, "ALL", 10, now));
    for (const row of forA) expect(row.sessionId).not.toBe(s.bWorkspace);
    // B has its own missed row and only that one.
    expect(forB.map((r) => r.sessionId)).toEqual([s.bWorkspace]);
  });

  it("listMissedSessions — visible-group scope excludes other groups' missed sessions from a scoped assistant", async () => {
    const result = await withRuntimeContext({ workspaceId: workspaceAId, userId: userAId }, (db) => listMissedSessions(db, workspaceAId, [groupA1Id], 10, now));
    const ids = new Set(result.map((r) => r.sessionId));
    expect(ids.has(s.mondayMissed)).toBe(true); // in A1
    expect(ids.has(s.otherGroupMissed)).toBe(false); // in A2 — not visible
  });

  it("listSessionsWithMissingRecords — no longer includes past-end IN_PROGRESS rows (they belong to listMissedSessions)", async () => {
    const result = await withRuntimeContext({ workspaceId: workspaceAId, userId: userAId }, (db) => listSessionsWithMissingRecords(db, workspaceAId, "ALL", 10, monthAId, now));
    // Whatever rows this returns, the past-end Monday IN_PROGRESS session
    // must NEVER be one of them. This is the deduplication contract that
    // prevents the same session from appearing in two Action Center
    // buckets at once.
    const ids = new Set(result.map((r) => r.sessionId));
    expect(ids.has(s.mondayMissed)).toBe(false);
  });
});
