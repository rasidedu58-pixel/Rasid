/**
 * Student code generation — real-Postgres concurrency proof.
 *
 * The in-memory repository fixture proves the sequence math but says
 * nothing about how the advisory lock behaves under real concurrent
 * connections. This test seeds a workspace, then fires N `insertStudent
 * WithUniqueCode` calls in parallel on the real DB and asserts:
 *
 *   1. Every inserted row has a distinct 5-digit code.
 *   2. Codes are contiguous (00001..N) — the advisory lock actually
 *      serialised them; no skips, no duplicates.
 *   3. Zero rows failed with a `students_workspace_student_code_unique`
 *      constraint violation.
 *
 * Same skip pattern as the other integration tests in this package —
 * requires `DATABASE_URL`, `MIGRATION_DATABASE_URL`, and a built
 * `dist/`. Skips cleanly everywhere else, runs in CI once a Postgres
 * service is provisioned.
 *
 * Production data is NEVER touched — a throwaway workspace is created
 * and torn down by this suite alone.
 */
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, insertStudentWithUniqueCode, withRuntimeContext } from "@academic-precision/database";

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
    "[student-code-concurrency.integration.test] Skipping: requires DATABASE_URL " +
      "+ MIGRATION_DATABASE_URL (distinct, live Postgres) AND a built package " +
      "(dist/index.js). Expected to skip in CI / sandboxes without live DB creds " +
      "and in a pre-build local run — this is not a failure.",
  );
}

describe.skipIf(!hasLiveCreds)("Student code — concurrent create-under-advisory-lock (live Postgres)", () => {
  let admin: Sql;

  const workspaceId = randomUUID();
  const userId = randomUUID();
  const CONCURRENCY = 20;

  beforeAll(async () => {
    admin = postgres(MIGRATION_DATABASE_URL!, { max: 4, prepare: false });
    await admin`INSERT INTO users (id, full_name, email_display, status) VALUES
      (${userId}, 'Student-Code Concurrency Test User', 'student-code-concurrency@example.test', 'ACTIVE')`;
    await admin`INSERT INTO workspaces
      (id, owner_user_id, name, workspace_type, locale, timezone, due_date_policy, status) VALUES
      (${workspaceId}, ${userId}, 'Student-Code Concurrency Test Workspace', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE')`;
  });

  afterAll(async () => {
    try {
      await admin`DELETE FROM students WHERE workspace_id = ${workspaceId}`;
      await admin`DELETE FROM workspaces WHERE id = ${workspaceId}`;
      await admin`DELETE FROM users WHERE id = ${userId}`;
    } finally {
      await admin.end({ timeout: 5 });
      await closeDb();
    }
  });

  it(`assigns ${CONCURRENCY} contiguous 5-digit codes with zero collisions under simultaneous create`, async () => {
    // Fire N parallel inserts on the real runtime pool. Each runs in its
    // OWN db.transaction (see insertStudentWithUniqueCode), so each
    // acquires its own advisory lock — Postgres queues them at the lock,
    // and the sequence must land contiguous.
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        withRuntimeContext({ workspaceId, userId }, (db) =>
          insertStudentWithUniqueCode(db, {
            workspaceId,
            name: `طالب ${i}`,
            searchNameNormalized: `طالب ${i}`,
          }),
        ),
      ),
    );

    // (1) Every code is a valid 5-digit numeric.
    for (const row of results) {
      expect(row.studentCode).toMatch(/^[0-9]{5}$/);
    }

    // (2) Codes are distinct — no duplicates surfaced through the DB
    // unique constraint or the retry loop.
    const codes = new Set(results.map((r) => r.studentCode));
    expect(codes.size).toBe(CONCURRENCY);

    // (3) Codes are contiguous 00001..N under a single workspace — the
    // advisory lock actually serialised the sequence generation.
    const sorted = [...codes].map(Number).sort((a, b) => a - b);
    for (let i = 0; i < CONCURRENCY; i += 1) {
      expect(sorted[i]).toBe(i + 1);
    }
  });

  it("workspace-scoped: a second workspace's counter is independent (starts back at 00001)", async () => {
    const otherWorkspaceId = randomUUID();
    const otherUserId = randomUUID();
    try {
      await admin`INSERT INTO users (id, full_name, email_display, status) VALUES
        (${otherUserId}, 'Concurrency Test Owner B', 'concurrency-b@example.test', 'ACTIVE')`;
      await admin`INSERT INTO workspaces
        (id, owner_user_id, name, workspace_type, locale, timezone, due_date_policy, status) VALUES
        (${otherWorkspaceId}, ${otherUserId}, 'Concurrency Test Workspace B', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE')`;

      const first = await withRuntimeContext({ workspaceId: otherWorkspaceId, userId: otherUserId }, (db) =>
        insertStudentWithUniqueCode(db, {
          workspaceId: otherWorkspaceId,
          name: "أول طالب في الورشة الثانية",
          searchNameNormalized: "اول طالب في الورشة الثانية",
        }),
      );
      expect(first.studentCode).toBe("00001");
    } finally {
      await admin`DELETE FROM students WHERE workspace_id = ${otherWorkspaceId}`;
      await admin`DELETE FROM workspaces WHERE id = ${otherWorkspaceId}`;
      await admin`DELETE FROM users WHERE id = ${otherUserId}`;
    }
  });

  it("legacy AP-XXXXXX rows do NOT interfere with the numeric sequence (tighter regex ^[0-9]{5}$)", async () => {
    // Seed two legacy rows in a fresh workspace and confirm the next
    // numeric-code generation still starts at 00001 — the tightened
    // regex on the DB side ignores non-5-digit values entirely, so
    // stray shapes (`AP-...`, or a hypothetical `123`) cannot poison
    // the counter.
    const legacyWorkspaceId = randomUUID();
    const legacyUserId = randomUUID();
    try {
      await admin`INSERT INTO users (id, full_name, email_display, status) VALUES
        (${legacyUserId}, 'Legacy Concurrency Test Owner', 'concurrency-legacy@example.test', 'ACTIVE')`;
      await admin`INSERT INTO workspaces
        (id, owner_user_id, name, workspace_type, locale, timezone, due_date_policy, status) VALUES
        (${legacyWorkspaceId}, ${legacyUserId}, 'Legacy Concurrency Test Workspace', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE')`;
      // Two legacy rows with the pre-Phase-15 code shape.
      await admin`INSERT INTO students (id, workspace_id, student_code, name, search_name_normalized, status)
        VALUES (${randomUUID()}, ${legacyWorkspaceId}, 'AP-LEG001', 'قديم ١', 'قديم ١', 'ACTIVE')`;
      await admin`INSERT INTO students (id, workspace_id, student_code, name, search_name_normalized, status)
        VALUES (${randomUUID()}, ${legacyWorkspaceId}, 'AP-LEG002', 'قديم ٢', 'قديم ٢', 'ACTIVE')`;

      const first = await withRuntimeContext({ workspaceId: legacyWorkspaceId, userId: legacyUserId }, (db) =>
        insertStudentWithUniqueCode(db, {
          workspaceId: legacyWorkspaceId,
          name: "جديد",
          searchNameNormalized: "جديد",
        }),
      );
      expect(first.studentCode).toBe("00001");
    } finally {
      await admin`DELETE FROM students WHERE workspace_id = ${legacyWorkspaceId}`;
      await admin`DELETE FROM workspaces WHERE id = ${legacyWorkspaceId}`;
      await admin`DELETE FROM users WHERE id = ${legacyUserId}`;
    }
  });
});
