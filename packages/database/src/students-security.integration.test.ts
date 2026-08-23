/**
 * Phase 4 — Students/Guardians/QR/Enrollments real-Postgres integration
 * tests.
 *
 * Mirrors `./scheduling-security.integration.test.ts` exactly: two distinct
 * real connections (`MIGRATION_DATABASE_URL` admin / `DATABASE_URL`
 * app_runtime), imports the COMPILED package entry point (`../dist/index.js`)
 * rather than raw TS source for the same dual-package-hazard reason
 * documented there, and self-skips entirely when live credentials + a prior
 * build aren't available — this is expected in this sandbox and in CI; it
 * is NOT part of what `pnpm test` needs to pass without live Supabase
 * credentials.
 *
 * Requires migrations 0008-0019 to already be applied against the target
 * database.
 */
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, withRuntimeContext } from "@academic-precision/database";

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
    "[students-security.integration.test] Skipping: requires DATABASE_URL (app_runtime) and " +
      "MIGRATION_DATABASE_URL (postgres) set to distinct connection strings, AND this package " +
      "already built (`pnpm build` — dist/index.js must exist). Expected to skip in CI / " +
      "sandboxes without live Supabase credentials, and in a pre-build test run — this is not " +
      "a failure.",
  );
}

describe.skipIf(!hasLiveCreds)("Phase 4 Students Security (live Postgres)", () => {
  let admin: Sql;

  const workspaceAId = randomUUID();
  const workspaceBId = randomUUID();
  const userAId = randomUUID();
  const userBId = randomUUID();
  const membershipAId = randomUUID();
  const membershipBId = randomUUID();
  const groupAId = randomUUID();
  const groupBId = randomUUID();
  const monthAId = randomUUID();
  const monthBId = randomUUID();
  const groupMonthAId = randomUUID();
  const groupMonthBId = randomUUID();
  const studentAId = randomUUID();
  const studentBId = randomUUID();
  const guardianAId = randomUUID();

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    admin = postgres(MIGRATION_DATABASE_URL!, { max: 2 });

    await admin`INSERT INTO users (id, full_name, email_display, status) VALUES
      (${userAId}, 'Students Test User A', 'students-test-a@example.test', 'ACTIVE'),
      (${userBId}, 'Students Test User B', 'students-test-b@example.test', 'ACTIVE')`;

    await admin`INSERT INTO workspaces
      (id, owner_user_id, name, workspace_type, locale, timezone, due_date_policy, status) VALUES
      (${workspaceAId}, ${userAId}, 'Students Test Workspace A', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE'),
      (${workspaceBId}, ${userBId}, 'Students Test Workspace B', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE')`;

    await admin`INSERT INTO memberships (id, workspace_id, user_id, role_label, status, joined_at) VALUES
      (${membershipAId}, ${workspaceAId}, ${userAId}, 'OWNER', 'ACTIVE', now()),
      (${membershipBId}, ${workspaceBId}, ${userBId}, 'OWNER', 'ACTIVE', now())`;

    await admin`INSERT INTO groups (id, workspace_id, name, status) VALUES
      (${groupAId}, ${workspaceAId}, 'Students Test Group A', 'ACTIVE'),
      (${groupBId}, ${workspaceBId}, 'Students Test Group B', 'ACTIVE')`;

    await admin`INSERT INTO operating_months (id, workspace_id, year, month, status, created_by) VALUES
      (${monthAId}, ${workspaceAId}, 2026, 8, 'CURRENT', ${userAId}),
      (${monthBId}, ${workspaceBId}, 2026, 8, 'CURRENT', ${userBId})`;

    await admin`INSERT INTO group_months (id, workspace_id, group_id, operating_month_id, base_fee_minor, due_policy, join_fee_policy)
      VALUES
        (${groupMonthAId}, ${workspaceAId}, ${groupAId}, ${monthAId}, 60000, 'PER_GROUP', 'FULL'),
        (${groupMonthBId}, ${workspaceBId}, ${groupBId}, ${monthBId}, 60000, 'PER_GROUP', 'FULL')`;

    await admin`INSERT INTO students (id, workspace_id, student_code, name, search_name_normalized, status)
      VALUES
        (${studentAId}, ${workspaceAId}, 'AP-TESTA1', 'Student A', 'student a', 'ACTIVE'),
        (${studentBId}, ${workspaceBId}, 'AP-TESTB1', 'Student B', 'student b', 'ACTIVE')`;

    await admin`INSERT INTO guardians (id, workspace_id, name, phone, normalized_phone)
      VALUES (${guardianAId}, ${workspaceAId}, 'Guardian A', '+201000000000', '201000000000')`;
  });

  afterAll(async () => {
    try {
      await admin`DELETE FROM enrollments WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM qr_credentials WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM student_guardians WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM guardians WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM students WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM group_months WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM permission_group_scopes WHERE group_id IN (${groupAId}, ${groupBId})`;
      await admin`DELETE FROM operating_months WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM groups WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM memberships WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM workspaces WHERE id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM users WHERE id IN (${userAId}, ${userBId})`;
    } finally {
      await admin.end({ timeout: 5 });
      await closeDb();
    }
  });

  it("1. RLS blocks cross-workspace SELECT on students for app_runtime", async () => {
    const rows = await withRuntimeContext({ workspaceId: workspaceAId }, (db) =>
      db.execute(sql`SELECT * FROM students WHERE id = ${studentBId}`),
    );
    expect(rows).toHaveLength(0);

    const ownRows = await withRuntimeContext({ workspaceId: workspaceAId }, (db) =>
      db.execute(sql`SELECT * FROM students WHERE id = ${studentAId}`),
    );
    expect(ownRows).toHaveLength(1);
  });

  it("2. RLS blocks cross-workspace SELECT on enrollments for app_runtime", async () => {
    const enrollmentId = randomUUID();
    await admin`INSERT INTO enrollments (id, workspace_id, student_id, group_month_id, join_date, status, fee_method)
      VALUES (${enrollmentId}, ${workspaceAId}, ${studentAId}, ${groupMonthAId}, '2026-08-01', 'ACTIVE', 'FULL_MONTH')`;

    const rows = await withRuntimeContext({ workspaceId: workspaceBId }, (db) =>
      db.execute(sql`SELECT * FROM enrollments WHERE id = ${enrollmentId}`),
    );
    expect(rows).toHaveLength(0);

    const ownRows = await withRuntimeContext({ workspaceId: workspaceAId }, (db) =>
      db.execute(sql`SELECT * FROM enrollments WHERE id = ${enrollmentId}`),
    );
    expect(ownRows).toHaveLength(1);

    await admin`DELETE FROM enrollments WHERE id = ${enrollmentId}`;
  });

  it("3. the enrollments cross-workspace guard trigger rejects student_id/group_month_id from a different workspace", async () => {
    // workspace_id=A but student_id points at a student that belongs to workspace B.
    await expect(
      withRuntimeContext({ userId: userAId, workspaceId: workspaceAId }, (db) =>
        db.execute(
          sql`INSERT INTO enrollments (id, workspace_id, student_id, group_month_id, join_date, status, fee_method)
              VALUES (${randomUUID()}, ${workspaceAId}, ${studentBId}, ${groupMonthAId}, '2026-08-01', 'ACTIVE', 'FULL_MONTH')`,
        ),
      ),
    ).rejects.toThrow(/belonging to a different workspace/i);

    // workspace_id=A but group_month_id points at a (validly-seeded)
    // group_month belonging to workspace B.
    await expect(
      withRuntimeContext({ userId: userAId, workspaceId: workspaceAId }, (db) =>
        db.execute(
          sql`INSERT INTO enrollments (id, workspace_id, student_id, group_month_id, join_date, status, fee_method)
              VALUES (${randomUUID()}, ${workspaceAId}, ${studentAId}, ${groupMonthBId}, '2026-08-01', 'ACTIVE', 'FULL_MONTH')`,
        ),
      ),
    ).rejects.toThrow(/belonging to a different workspace/i);
  });

  it("4. the qr_credentials cross-workspace guard trigger rejects a student_id from a different workspace", async () => {
    await expect(
      withRuntimeContext({ userId: userAId, workspaceId: workspaceAId }, (db) =>
        db.execute(
          sql`INSERT INTO qr_credentials (id, workspace_id, student_id, token_hash, status, issued_by_user_id)
              VALUES (${randomUUID()}, ${workspaceAId}, ${studentBId}, ${createHash("sha256").update("x").digest("hex")}, 'ACTIVE', ${userAId})`,
        ),
      ),
    ).rejects.toThrow(/belonging to a different workspace/i);
  });

  it("5. the student_guardians cross-workspace guard trigger rejects a student_id/guardian_id from a different workspace", async () => {
    const foreignGuardianId = randomUUID();
    await admin`INSERT INTO guardians (id, workspace_id, phone, normalized_phone) VALUES (${foreignGuardianId}, ${workspaceBId}, '+2', '2')`;

    await expect(
      withRuntimeContext({ userId: userAId, workspaceId: workspaceAId }, (db) =>
        db.execute(
          sql`INSERT INTO student_guardians (id, workspace_id, student_id, guardian_id, is_primary, academic_contact_enabled, financial_contact_enabled)
              VALUES (${randomUUID()}, ${workspaceAId}, ${studentAId}, ${foreignGuardianId}, false, true, true)`,
        ),
      ),
    ).rejects.toThrow(/belonging to a different workspace/i);

    await expect(
      withRuntimeContext({ userId: userAId, workspaceId: workspaceAId }, (db) =>
        db.execute(
          sql`INSERT INTO student_guardians (id, workspace_id, student_id, guardian_id, is_primary, academic_contact_enabled, financial_contact_enabled)
              VALUES (${randomUUID()}, ${workspaceAId}, ${studentBId}, ${guardianAId}, false, true, true)`,
        ),
      ),
    ).rejects.toThrow(/belonging to a different workspace/i);

    await admin`DELETE FROM guardians WHERE id = ${foreignGuardianId}`;
  });

  it("6. INT-04 — a second concurrent-ish ACTIVE qr_credentials row for the same student is rejected by the partial unique index", async () => {
    const first = randomUUID();
    const second = randomUUID();
    await admin`INSERT INTO qr_credentials (id, workspace_id, student_id, token_hash, status, issued_by_user_id)
      VALUES (${first}, ${workspaceAId}, ${studentAId}, ${createHash("sha256").update("token-1").digest("hex")}, 'ACTIVE', ${userAId})`;

    await expect(
      admin`INSERT INTO qr_credentials (id, workspace_id, student_id, token_hash, status, issued_by_user_id)
        VALUES (${second}, ${workspaceAId}, ${studentAId}, ${createHash("sha256").update("token-2").digest("hex")}, 'ACTIVE', ${userAId})`,
    ).rejects.toThrow(/duplicate key|unique constraint/i);

    await admin`DELETE FROM qr_credentials WHERE id = ${first}`;
  });

  it("7. INT-03 — a second primary guardian for the same student is rejected by the partial unique index", async () => {
    const secondGuardianId = randomUUID();
    await admin`INSERT INTO guardians (id, workspace_id, phone, normalized_phone) VALUES (${secondGuardianId}, ${workspaceAId}, '+2', '2')`;

    const firstLinkId = randomUUID();
    const secondLinkId = randomUUID();
    await admin`INSERT INTO student_guardians (id, workspace_id, student_id, guardian_id, is_primary, academic_contact_enabled, financial_contact_enabled)
      VALUES (${firstLinkId}, ${workspaceAId}, ${studentAId}, ${guardianAId}, true, true, true)`;

    await expect(
      admin`INSERT INTO student_guardians (id, workspace_id, student_id, guardian_id, is_primary, academic_contact_enabled, financial_contact_enabled)
        VALUES (${secondLinkId}, ${workspaceAId}, ${studentAId}, ${secondGuardianId}, true, true, true)`,
    ).rejects.toThrow(/duplicate key|unique constraint/i);

    await admin`DELETE FROM student_guardians WHERE id = ${firstLinkId}`;
    await admin`DELETE FROM guardians WHERE id = ${secondGuardianId}`;
  });
});
