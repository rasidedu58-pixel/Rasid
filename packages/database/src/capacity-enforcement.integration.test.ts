/**
 * Billing Phase 2 — Capacity Enforcement, real-Postgres integration tests.
 *
 * Mirrors `./carry-forward.integration.test.ts`: two real connections
 * (`MIGRATION_DATABASE_URL` admin / `DATABASE_URL` app_runtime), imports the
 * COMPILED package entry (`../dist/index.js`), and self-skips when live
 * credentials + a prior build aren't available. Exercises the REAL enforcement
 * (DISTINCT counts + `FOR UPDATE` serialisation) that a pure unit test cannot.
 *
 * HOW TO RUN (never against Production):
 *   1. Point at a DISPOSABLE / staging Postgres with the three roles
 *      (postgres / app_runtime / app_worker) — e.g. a throwaway Supabase branch
 *      or a local docker Postgres seeded with the role grants.
 *   2. Apply ALL migrations INCLUDING 0062:  pnpm --filter @academic-precision/database db:migrate
 *   3. Build:  pnpm --filter @academic-precision/database build
 *   4. Set DATABASE_URL (app_runtime) + MIGRATION_DATABASE_URL (postgres) to that
 *      disposable DB and:  pnpm --filter @academic-precision/database test
 *
 * Uses a CUSTOM plan with SMALL limits (2 students / 1 team) as test data, so
 * the limit is reached with a handful of rows instead of 500.
 */
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  acceptInvitationTx,
  closeDb,
  createInvitation,
  createOrReactivateEnrollmentTransaction,
  getActiveStudentUsage,
  getActiveTeamUsage,
  runCreateMonthTransaction,
  withRuntimeContext,
  CurrentOperationalMonthRequiredError,
  PlanStudentLimitReachedError,
  PlanTeamLimitReachedError,
} from "@academic-precision/database";

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const distEntryPoint = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const distBuilt = existsSync(distEntryPoint);
const hasLiveCreds = !!DATABASE_URL && !!MIGRATION_DATABASE_URL && DATABASE_URL !== MIGRATION_DATABASE_URL && distBuilt;

if (!hasLiveCreds) {
  // eslint-disable-next-line no-console
  console.warn(
    "[capacity-enforcement.integration.test] Skipping: requires DATABASE_URL (app_runtime) + " +
      "MIGRATION_DATABASE_URL (postgres) on a DISPOSABLE DB with migration 0062 applied, and a prior build. " +
      "Expected to skip in CI / sandboxes without live credentials — not a failure.",
  );
}

const OBLIGATION = { baseFeeMinor: 60000, currencyCode: "EGP", dueDate: "2026-08-15", calculationBasis: "FULL_MONTH" as const, calculationSnapshotJson: null };

describe.skipIf(!hasLiveCreds)("Billing Phase 2 — Capacity Enforcement (live Postgres)", () => {
  let admin: Sql;

  const wsId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const groupAId = randomUUID();
  const groupBId = randomUUID();
  const monthId = randomUUID();
  const gmAId = randomUUID();
  const gmBId = randomUUID();
  const s1 = randomUUID();
  const s2 = randomUUID();
  const s3 = randomUUID();
  const uC = randomUUID(); // team-test invitee C
  const uD = randomUUID(); // team-test invitee D

  // Seed a CUSTOM/ACTIVE subscription with a 2-student / 1-team limit.
  async function resetSubscription(maxStudents: number, maxTeam: number) {
    await admin`DELETE FROM subscriptions WHERE workspace_id = ${wsId}`;
    await admin`INSERT INTO subscriptions (workspace_id, state, plan_code, custom_max_active_students, custom_max_team_members)
      VALUES (${wsId}, 'ACTIVE', 'CUSTOM', ${maxStudents}, ${maxTeam})`;
  }

  async function enroll(studentId: string, groupMonthId: string) {
    return withRuntimeContext({ userId, workspaceId: wsId }, (db) =>
      createOrReactivateEnrollmentTransaction(db, {
        workspaceId: wsId,
        studentId,
        groupMonthId,
        joinDate: "2026-08-01",
        status: "ACTIVE",
        feeMethod: "FULL_MONTH",
        obligation: OBLIGATION,
      }),
    );
  }

  async function clearEnrollments() {
    await admin`DELETE FROM financial_obligations WHERE workspace_id = ${wsId}`;
    await admin`DELETE FROM enrollments WHERE workspace_id = ${wsId}`;
  }

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    admin = postgres(MIGRATION_DATABASE_URL!, { max: 4 });
    await admin`INSERT INTO users (id, full_name, email_display, status) VALUES (${userId}, 'Cap Owner', 'cap-owner@example.test', 'ACTIVE')`;
    await admin`INSERT INTO workspaces (id, owner_user_id, name, workspace_type, locale, timezone, due_date_policy, unified_due_day, status)
      VALUES (${wsId}, ${userId}, 'Cap WS', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'UNIFIED', 20, 'ACTIVE')`;
    await admin`INSERT INTO memberships (id, workspace_id, user_id, role_label, status, joined_at) VALUES (${membershipId}, ${wsId}, ${userId}, 'OWNER', 'ACTIVE', now())`;
    await admin`INSERT INTO groups (id, workspace_id, name, status) VALUES (${groupAId}, ${wsId}, 'Group A', 'ACTIVE'), (${groupBId}, ${wsId}, 'Group B', 'ACTIVE')`;
    await admin`INSERT INTO operating_months (id, workspace_id, year, month, status, created_by) VALUES (${monthId}, ${wsId}, 2026, 8, 'CURRENT', ${userId})`;
    await admin`INSERT INTO group_months (id, workspace_id, group_id, operating_month_id, base_fee_minor, due_policy, due_day, join_fee_policy) VALUES
      (${gmAId}, ${wsId}, ${groupAId}, ${monthId}, 60000, 'PER_GROUP', 15, 'FULL'),
      (${gmBId}, ${wsId}, ${groupBId}, ${monthId}, 60000, 'PER_GROUP', 15, 'FULL')`;
    await admin`INSERT INTO students (id, workspace_id, student_code, name, search_name_normalized, status) VALUES
      (${s1}, ${wsId}, 'AP-1', 'S1', 's1', 'ACTIVE'), (${s2}, ${wsId}, 'AP-2', 'S2', 's2', 'ACTIVE'), (${s3}, ${wsId}, 'AP-3', 'S3', 's3', 'ACTIVE')`;
  });

  afterEach(async () => {
    await clearEnrollments();
    await admin`UPDATE operating_months SET status = 'CURRENT' WHERE id = ${monthId}`;
  });

  afterAll(async () => {
    try {
      // FK-safe order: children before parents. permission_group_scopes is keyed
      // by group_id; everything else here carries workspace_id.
      await admin`DELETE FROM permission_group_scopes WHERE group_id IN (${groupAId}, ${groupBId})`;
      for (const t of [
        "financial_obligations",
        "enrollments",
        "students",
        "permission_grants",
        "workspace_invitations",
        "group_months",
        "operating_months",
        "groups",
        "subscriptions",
        "memberships",
        "audit_events",
      ]) {
        await admin.unsafe(`DELETE FROM ${t} WHERE workspace_id = $1`, [wsId]);
      }
      await admin`DELETE FROM workspaces WHERE id = ${wsId}`;
      await admin`DELETE FROM users WHERE id IN (${userId}, ${uC}, ${uD})`;
    } finally {
      await admin.end({ timeout: 5 });
      await closeDb();
    }
  });

  it("counts UNIQUE active students in the CURRENT month — a student in two groups counts once", async () => {
    await resetSubscription(1_000_000, 1_000_000); // unbounded while seeding
    await enroll(s1, gmAId);
    await enroll(s1, gmBId); // same student, second group
    await enroll(s2, gmAId);
    const usage = await withRuntimeContext({ userId, workspaceId: wsId }, (db) => getActiveStudentUsage(db, wsId));
    expect(usage.currentMonthId).toBe(monthId);
    expect(usage.activeStudents).toBe(2); // s1 counted once
  });

  it("throws CURRENT_OPERATIONAL_MONTH_REQUIRED when there is no CURRENT month (no phantom zero)", async () => {
    await resetSubscription(2, 1);
    await admin`UPDATE operating_months SET status = 'ARCHIVED' WHERE id = ${monthId}`;
    await expect(withRuntimeContext({ userId, workspaceId: wsId }, (db) => getActiveStudentUsage(db, wsId))).rejects.toBeInstanceOf(CurrentOperationalMonthRequiredError);
  });

  it("blocks a NEW unique student over the limit, but ALLOWS an already-active student to join another group", async () => {
    await resetSubscription(2, 1);
    await enroll(s1, gmAId);
    await enroll(s2, gmAId); // usage now 2/2
    await expect(enroll(s3, gmAId)).rejects.toBeInstanceOf(PlanStudentLimitReachedError); // 3rd new student blocked
    await expect(enroll(s1, gmBId)).resolves.toBeDefined(); // already-active → second group allowed even at cap
    const usage = await withRuntimeContext({ userId, workspaceId: wsId }, (db) => getActiveStudentUsage(db, wsId));
    expect(usage.activeStudents).toBe(2);
  });

  it("two concurrent activations at 1/2 cannot both pass (no 3rd unique student slips through)", async () => {
    await resetSubscription(2, 1);
    await enroll(s1, gmAId); // usage 1/2
    const results = await Promise.allSettled([enroll(s2, gmAId), enroll(s3, gmAId)]);
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const blocked = results.filter((r) => r.status === "rejected" && (r as PromiseRejectedResult).reason instanceof PlanStudentLimitReachedError).length;
    expect(ok).toBe(1);
    expect(blocked).toBe(1);
    const usage = await withRuntimeContext({ userId, workspaceId: wsId }, (db) => getActiveStudentUsage(db, wsId));
    expect(usage.activeStudents).toBe(2); // never 3
  });

  it("simultaneous invitation accepts cannot exceed the team limit (Owner never counted)", async () => {
    await resetSubscription(1_000_000, 1); // team limit = 1
    await admin`INSERT INTO users (id, full_name, email_display, status) VALUES (${uC}, 'C', 'cap-c@example.test', 'ACTIVE'), (${uD}, 'D', 'cap-d@example.test', 'ACTIVE')`;
    const hashC = randomUUID().replace(/-/g, "");
    const hashD = randomUUID().replace(/-/g, "");
    for (const [h, label] of [[hashC, "C"], [hashD, "D"]] as const) {
      await withRuntimeContext({ userId, workspaceId: wsId }, (db) =>
        createInvitation(db, { workspaceId: wsId, tokenHash: h, roleLabel: "MEMBER", desiredGrants: [{ permissionKey: "students.view_basic", scopeType: "ALL_GROUPS" }], invitedLabel: label, invitedByUserId: userId, expiresAt: new Date(Date.now() + 3600_000) }),
      );
    }
    const results = await Promise.allSettled([
      withRuntimeContext({ userId: uC }, (db) => acceptInvitationTx(db, { tokenHash: hashC, accepterUserId: uC })),
      withRuntimeContext({ userId: uD }, (db) => acceptInvitationTx(db, { tokenHash: hashD, accepterUserId: uD })),
    ]);
    const okAccepts = results.filter((r) => r.status === "fulfilled" && (r.value as { ok: boolean }).ok).length;
    const blockedByLimit = results.filter((r) => r.status === "rejected" && (r as PromiseRejectedResult).reason instanceof PlanTeamLimitReachedError).length;
    expect(okAccepts).toBe(1); // only one non-owner activated
    expect(blockedByLimit).toBe(1); // the other refused by the team limit, not a 500
    const team = await withRuntimeContext({ userId, workspaceId: wsId }, (db) => getActiveTeamUsage(db, wsId));
    expect(team).toBe(1);
    // uC/uD, their membership + grants + invitations are cleaned in afterAll (FK-safe order).
  });

  it("carry-forward is refused atomically when it would exceed the plan's student limit", async () => {
    await resetSubscription(2, 1); // limit 2
    // Seed a prior month with 3 ACTIVE students to carry forward.
    const priorMonth = randomUUID();
    const priorGm = randomUUID();
    await admin`INSERT INTO operating_months (id, workspace_id, year, month, status, created_by) VALUES (${priorMonth}, ${wsId}, 2026, 7, 'DRAFT', ${userId})`;
    await admin`INSERT INTO group_months (id, workspace_id, group_id, operating_month_id, base_fee_minor, due_policy, due_day, join_fee_policy) VALUES (${priorGm}, ${wsId}, ${groupAId}, ${priorMonth}, 60000, 'PER_GROUP', 15, 'FULL')`;
    for (const s of [s1, s2, s3]) {
      await admin`INSERT INTO enrollments (id, workspace_id, student_id, group_month_id, join_date, status, fee_method) VALUES (${randomUUID()}, ${wsId}, ${s}, ${priorGm}, '2026-07-01', 'ACTIVE', 'FULL_MONTH')`;
    }
    await expect(
      withRuntimeContext({ userId, workspaceId: wsId }, (db) =>
        runCreateMonthTransaction(db, {
          workspaceId: wsId,
          workspaceTimezone: "Africa/Cairo",
          targetYear: 2026,
          targetMonth: 9,
          createdByUserId: userId,
          createdByMembershipId: membershipId,
          targetStatus: "DRAFT",
          groupSpecs: [{ groupId: groupAId, locationId: null, baseFeeMinor: 60000, currencyCode: "EGP", duePolicy: "PER_GROUP", dueDay: 15, joinFeePolicy: "FULL", scheduleRules: [], sourceGroupMonthId: priorGm }],
        }),
      ),
    ).rejects.toBeInstanceOf(PlanStudentLimitReachedError);
    await admin`DELETE FROM enrollments WHERE group_month_id = ${priorGm}`;
    await admin`DELETE FROM group_months WHERE id = ${priorGm}`;
    await admin`DELETE FROM operating_months WHERE id = ${priorMonth}`;
  });
});
