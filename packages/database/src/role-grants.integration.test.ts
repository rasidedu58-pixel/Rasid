/**
 * Role-grant guardrails (live Postgres, admin connection only).
 *
 * These assert the table privileges the app roles MUST have for the hot paths
 * that broke in production during the Aug/Sep launch week:
 *   - app_runtime INSERT on the 7 provisioning tables — the exact class of
 *     regression migration 0062 introduced (column-level INSERT on subscriptions
 *     dropped the table-level grant → `permission denied for table subscriptions`
 *     → GET /me 500 on every fresh signup) and 0071 fixed. If a future migration
 *     narrows one of these again, this test fails BEFORE it reaches production.
 *   - app_platform_admin SELECT on the operational-snapshot tables — the grants
 *     the Platform-Operations console (operating_months snapshot) needs; a gap
 *     here produced `permission denied for table operating_months`.
 *
 * Uses `has_table_privilege(role, table, priv)` — a pure catalog query, so it
 * needs ONLY the admin MIGRATION_DATABASE_URL (no SET ROLE, no app_runtime URL),
 * and runs locally as well as in CI.
 */
import { readFileSync } from "node:fs";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const hasCreds = !!MIGRATION_DATABASE_URL;
if (!hasCreds) {
  // eslint-disable-next-line no-console
  console.warn("[role-grants.integration.test] Skipping: requires MIGRATION_DATABASE_URL (admin). Not a failure.");
}

// The 7 tables the provisioning transaction writes (createUserWorkspaceMembership
// + owner trial + subscription + entitlements + audit). All must be INSERTable
// by app_runtime or a fresh signup's first GET /me 500s during provisioning.
const PROVISIONING_TABLES = ["users", "workspaces", "memberships", "owner_trial_grants", "subscriptions", "entitlements", "audit_events"];

// The tables the Platform-Operations operational snapshot reads as app_platform_admin.
const SNAPSHOT_TABLES = ["operating_months", "groups", "students", "enrollments", "sessions", "group_months", "audit_events"];

describe.skipIf(!hasCreds)("Role grants — provisioning & platform snapshot (live Postgres)", () => {
  let admin: Sql;
  beforeAll(() => {
    admin = postgres(MIGRATION_DATABASE_URL!, { max: 1, prepare: false });
  });
  afterAll(async () => {
    if (admin) await admin.end({ timeout: 5 });
  });

  it("app_runtime can INSERT + SELECT every provisioning table (regression: 0062 → /me 500, fixed by 0071)", async () => {
    for (const t of PROVISIONING_TABLES) {
      const [row] = await admin`SELECT
        has_table_privilege('app_runtime', ${"public." + t}, 'SELECT') AS sel,
        has_table_privilege('app_runtime', ${"public." + t}, 'INSERT') AS ins`;
      expect(row.sel, `app_runtime SELECT ${t}`).toBe(true);
      expect(row.ins, `app_runtime INSERT ${t}`).toBe(true);
    }
  });

  it("app_platform_admin can SELECT every operational-snapshot table (regression: permission denied for table operating_months)", async () => {
    for (const t of SNAPSHOT_TABLES) {
      const [row] = await admin`SELECT has_table_privilege('app_platform_admin', ${"public." + t}, 'SELECT') AS sel`;
      expect(row.sel, `app_platform_admin SELECT ${t}`).toBe(true);
    }
  });
});
