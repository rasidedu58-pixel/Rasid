/**
 * RLS Security Delta — real-Postgres integration tests.
 *
 * These tests exercise Row Level Security against the LIVE Supabase Postgres
 * project (not mocks/fakes), using two distinct real connections: one via
 * `MIGRATION_DATABASE_URL` (privileged `postgres` role, BYPASSRLS, a raw
 * `postgres()` client used only for fixture setup/teardown and to prove
 * admin/migration tooling is unaffected) and one via `DATABASE_URL` (the
 * least-privilege `app_runtime` role under test) — reached through the REAL
 * production `getDb()`/`withRuntimeContext` helpers from `./connection`, so
 * this suite proves the actual production code path, not a reimplication
 * of it.
 *
 * This suite is SKIPPED ENTIRELY when live credentials aren't available
 * (e.g. CI, or a contributor's machine without a real Supabase project
 * configured) — both env vars must be set AND distinct, since the whole
 * point of the suite is comparing behavior across two different roles. It
 * is NOT part of what `pnpm test` needs to pass in a credential-free
 * environment: it self-skips rather than failing or erroring.
 *
 * Requires migration 0006_runtime_role_least_privilege.sql to have already
 * been applied against the target database (creates `app_runtime`,
 * grants/revokes, and the `*_self_read` policies this suite exercises).
 */
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// Imported via the package's own compiled entry point (dist/, resolved
// through package.json "exports", exactly how apps/api consumes this
// package in production) rather than the relative "./connection" TS
// source. Importing the raw TS source directly under Vitest's transform
// pipeline loads a second, distinct copy of `drizzle-orm` than the one the
// compiled `dist/schema/*.js` Table objects were constructed against,
// which breaks drizzle's internal `is(value, Table)` identity checks
// (`extractTablesRelationalConfig` throws on a spurious `null`). The
// compiled dist/ avoids this "dual package hazard" entirely and is also
// the actually-shipped code path.
import { closeDb, getDb, withRuntimeContext } from "@academic-precision/database";

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
    "[rls-security.integration.test] Skipping: requires DATABASE_URL (app_runtime) and " +
      "MIGRATION_DATABASE_URL (postgres) set to distinct connection strings, AND this " +
      "package already built (`pnpm build` — dist/index.js must exist, since this suite " +
      "imports the compiled package entry point rather than raw TS source; see the " +
      "import comment above for why). Expected to skip in CI / sandboxes without live " +
      "Supabase credentials, and in a pre-build test run — this is not a failure.",
  );
}

describe.skipIf(!hasLiveCreds)("RLS Security Delta (live Postgres)", () => {
  let admin: Sql;

  // Fixture ids, generated fresh per suite run.
  const workspaceAId = randomUUID();
  const workspaceBId = randomUUID();
  const userAId = randomUUID();
  const userA2Id = randomUUID(); // second, already-active member of workspace A
  const userA3Id = randomUUID(); // third member of workspace A — the one whose membership is DISABLED
  const userBId = randomUUID();
  const membershipAId = randomUUID();
  const membershipA2Id = randomUUID(); // ACTIVE, used as the "other" reader in scenario 4
  const membershipADisabledId = randomUUID(); // DISABLED membership in workspace A (userA3Id)
  const membershipBId = randomUUID();

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    admin = postgres(MIGRATION_DATABASE_URL!, { max: 2 });

    // Seed two independent workspaces (A, B), each with users + memberships,
    // using the privileged ADMIN connection directly (raw SQL) — no need to
    // go through application repository functions for fixture setup.
    await admin`INSERT INTO users (id, full_name, email_display, status) VALUES
      (${userAId}, 'RLS Test User A', 'rls-test-a@example.test', 'ACTIVE'),
      (${userA2Id}, 'RLS Test User A2', 'rls-test-a2@example.test', 'ACTIVE'),
      (${userA3Id}, 'RLS Test User A3', 'rls-test-a3@example.test', 'ACTIVE'),
      (${userBId}, 'RLS Test User B', 'rls-test-b@example.test', 'ACTIVE')`;

    await admin`INSERT INTO workspaces
      (id, owner_user_id, name, workspace_type, locale, timezone, due_date_policy, status) VALUES
      (${workspaceAId}, ${userAId}, 'RLS Test Workspace A', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE'),
      (${workspaceBId}, ${userBId}, 'RLS Test Workspace B', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE')`;

    await admin`INSERT INTO memberships (id, workspace_id, user_id, role_label, status, joined_at) VALUES
      (${membershipAId}, ${workspaceAId}, ${userAId}, 'OWNER', 'ACTIVE', now()),
      (${membershipA2Id}, ${workspaceAId}, ${userA2Id}, 'ASSISTANT', 'ACTIVE', now()),
      (${membershipADisabledId}, ${workspaceAId}, ${userA3Id}, 'ASSISTANT', 'DISABLED', now()),
      (${membershipBId}, ${workspaceBId}, ${userBId}, 'OWNER', 'ACTIVE', now())`;
  });

  afterAll(async () => {
    try {
      // Clean up ALL seeded test data, regardless of pass/fail.
      await admin`DELETE FROM permission_grants WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM memberships WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM workspaces WHERE id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM users WHERE id IN (${userAId}, ${userA2Id}, ${userA3Id}, ${userBId})`;
    } finally {
      await admin.end({ timeout: 5 });
      await closeDb(); // closes the shared app_runtime pool used by getDb()/withRuntimeContext
    }
  });

  it("1. runtime role (app_runtime) has NOBYPASSRLS", async () => {
    const result = await getDb().execute(
      sql`SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    expect((result[0] as { rolbypassrls: boolean } | undefined)?.rolbypassrls).toBe(false);
  });

  it("2. cross-workspace SELECT leak is blocked at the DB level, even with no WHERE-clause tenant filter", async () => {
    const rowsForB = await withRuntimeContext({ workspaceId: workspaceAId }, (db) =>
      db.execute(sql`SELECT * FROM workspaces WHERE id = ${workspaceBId}`),
    );
    expect(rowsForB).toHaveLength(0);

    // Even a query with NO tenant filter at all — the literal
    // "application forgot the WHERE clause" scenario — still cannot see
    // workspace B's row, because RLS filters at the database level
    // regardless of the application's WHERE clause.
    const allWorkspaces = await withRuntimeContext({ workspaceId: workspaceAId }, (db) =>
      db.execute(sql`SELECT * FROM workspaces`),
    );
    const ids = allWorkspaces.map((r) => (r as { id: string }).id);
    expect(ids).toContain(workspaceAId);
    expect(ids).not.toContain(workspaceBId);
  });

  it("3a. cross-workspace INSERT into memberships/permission_grants is rejected", async () => {
    await expect(
      withRuntimeContext({ userId: userAId, workspaceId: workspaceAId }, (db) =>
        db.execute(
          sql`INSERT INTO memberships (id, workspace_id, user_id, role_label, status, joined_at)
              VALUES (${randomUUID()}, ${workspaceBId}, ${userAId}, 'ASSISTANT', 'ACTIVE', now())`,
        ),
      ),
    ).rejects.toThrow();

    await expect(
      withRuntimeContext({ userId: userAId, workspaceId: workspaceAId }, (db) =>
        db.execute(
          sql`INSERT INTO permission_grants (id, workspace_id, membership_id, permission_key, scope_type, created_by_user_id)
              VALUES (${randomUUID()}, ${workspaceBId}, ${membershipBId}, 'students.view', 'ALL_GROUPS', ${userAId})`,
        ),
      ),
    ).rejects.toThrow();
  });

  it("3b. cross-workspace UPDATE against a foreign row is a no-op (rejected by RLS, no mutation occurs)", async () => {
    // RLS's `USING` clause makes workspace B's row invisible to an UPDATE
    // scoped to workspace A — the statement succeeds but affects zero
    // rows, rather than throwing.
    const result = await withRuntimeContext({ userId: userAId, workspaceId: workspaceAId }, (db) =>
      db.execute(sql`UPDATE memberships SET status = 'DISABLED' WHERE id = ${membershipBId}`),
    );
    expect(result.length).toBe(0);

    const unchanged = await admin`SELECT status FROM memberships WHERE id = ${membershipBId}`;
    expect(unchanged[0]?.status).toBe("ACTIVE");
  });

  it("3c. DELETE from the runtime role fails outright due to lack of GRANT (not just RLS)", async () => {
    await expect(
      withRuntimeContext({ userId: userAId, workspaceId: workspaceAId }, (db) =>
        db.execute(sql`DELETE FROM memberships WHERE id = ${membershipAId}`),
      ),
    ).rejects.toThrow(/permission denied|insufficient privilege/i);

    const stillThere = await admin`SELECT id FROM memberships WHERE id = ${membershipAId}`;
    expect(stillThere[0]?.id).toBe(membershipAId);
  });

  it("4. disabled membership: history stays visible; RLS itself is agnostic to 'disabled' (an application-layer concept)", async () => {
    // (a) A disabled membership row remains readable via a workspace-scoped
    // administrative read from within its own workspace (proving disable
    // doesn't hide history) — read as another already-active member of the
    // same workspace, not the disabled user itself.
    const rows = await withRuntimeContext({ userId: userA2Id, workspaceId: workspaceAId }, (db) =>
      db.execute(sql`SELECT * FROM memberships WHERE workspace_id = ${workspaceAId}`),
    );
    const disabledRow = rows.find((r) => (r as { id: string }).id === membershipADisabledId) as
      | { status: string }
      | undefined;
    expect(disabledRow).toBeDefined();
    expect(disabledRow?.status).toBe("DISABLED");

    // (b) A mutation attempt using the DISABLED membership's own identity
    // context against its OWN workspace's permission_grants table is still
    // allowed at the RLS/DB level — RLS has no notion of "disabled", that
    // is an application-layer concept enforced by
    // PermissionResolverService/PermissionGuard, already covered by Phase
    // 2's permission-resolver.service.spec.ts unit tests. This assertion
    // intentionally documents RLS's honest scope: it preserves tenant
    // isolation and history visibility, not membership-status semantics.
    const grantId = randomUUID();
    const inserted = await withRuntimeContext({ userId: userA2Id, workspaceId: workspaceAId }, (db) =>
      db.execute(
        sql`INSERT INTO permission_grants (id, workspace_id, membership_id, permission_key, scope_type, created_by_user_id)
            VALUES (${grantId}, ${workspaceAId}, ${membershipADisabledId}, 'students.view', 'ALL_GROUPS', ${userA2Id})
            RETURNING id`,
      ),
    );
    expect(inserted).toHaveLength(1);

    // Cleanup this scenario's extra grant row immediately (afterAll also
    // sweeps workspace A/B grants, but keep this test self-contained).
    await admin`DELETE FROM permission_grants WHERE id = ${grantId}`;
  });

  it("6. regression: a pooled connection previously scoped to a workspace must not leak a stale empty placeholder into a later workspaceId-less call", async () => {
    // 12 concurrent live round-trips to the remote Supabase instance can
    // occasionally exceed Vitest's 5s default under CPU/network
    // contention (e.g. other test suites running concurrently on the same
    // machine) without indicating any real regression — bump the timeout
    // rather than risk a flaky failure. See the closing arg of `it(...)`.
    // Real bug found during manual verification of this delta: once
    // `set_config('app.workspace_id', <value>, true)` ("SET LOCAL") has
    // been called on a physical connection, Postgres registers a
    // session-level placeholder for that custom GUC name. When that
    // transaction ends, the value resets — but to an EMPTY STRING, not to
    // "unset" (NULL); `current_setting(name, true)` only returns NULL for
    // a name that has NEVER been touched at all in the session. Since
    // postgres.js pools physical connections (max: 10) across unrelated
    // `withRuntimeContext` calls, a LATER call that only sets
    // `app.user_id` (e.g. the `GET /me` cross-workspace self-read path,
    // which deliberately never sets `app.workspace_id`) could reuse a
    // connection that previously had `app.workspace_id` set, see the
    // stale '' placeholder instead of NULL, and crash with `invalid input
    // syntax for type uuid: ""` when a workspace-scoped RLS policy tried
    // to cast it — a real 500 on a completely legitimate request. Fixed in
    // migration 0007 by wrapping every policy's `current_setting(...)`
    // read in `NULLIF(..., '')` before the `::uuid` cast.
    //
    // This test forces exactly that connection-reuse sequence by running
    // enough workspace-scoped transactions to exhaust/cycle the pool, then
    // immediately following with a workspaceId-less (`app.user_id` only)
    // call and asserting it succeeds rather than throwing.
    const workspaceScopedCalls = Array.from({ length: 12 }, (_, i) =>
      withRuntimeContext({ userId: userAId, workspaceId: i % 2 === 0 ? workspaceAId : workspaceBId }, (db) =>
        db.execute(sql`SELECT 1`),
      ),
    );
    await Promise.all(workspaceScopedCalls);

    // If the bug were still present, this call would reject with
    // "invalid input syntax for type uuid" instead of resolving — letting
    // it throw un-caught here fails the test with that exact error.
    const rows = await withRuntimeContext({ userId: userAId }, (db) =>
      db.execute(sql`SELECT workspace_id FROM memberships WHERE user_id = ${userAId}`),
    );
    expect(rows.map((r) => (r as { workspace_id: string }).workspace_id)).toContain(workspaceAId);
  }, 20000);

  it("5. the privileged admin (MIGRATION_DATABASE_URL) connection is unaffected — BYPASSRLS, sees across both workspaces", async () => {
    const roleRows = await admin`SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(roleRows[0]?.rolbypassrls).toBe(true);

    const both = await admin`SELECT id FROM workspaces WHERE id IN (${workspaceAId}, ${workspaceBId})`;
    expect(both.map((r) => r.id).sort()).toEqual([workspaceAId, workspaceBId].sort());
  });
});
