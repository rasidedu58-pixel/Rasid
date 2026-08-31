/**
 * Platform invite acceptance — real-Postgres integration test.
 *
 * Proves the acceptance/claim paths against a LIVE database, through the REAL
 * production `getPlatformAdminDb()` connection (the `app_platform_admin` role),
 * NOT mocks. The whole point: the person accepting a staff invite is NOT a
 * platform admin, and the customer claiming an onboarding invite is an ordinary
 * tenant user — yet both writes succeed, because the SERVER performs them on its
 * privileged `app_platform_admin` connection (the writes granted in 0060/0059),
 * after verifying token hash + authenticated email + single-use in-transaction.
 * Neither path needs any `app_runtime` grant.
 *
 * SKIPS ENTIRELY without live creds (CI / credential-free machines): requires
 *   - MIGRATION_DATABASE_URL   (privileged `postgres`, BYPASSRLS) for fixtures,
 *   - PLATFORM_ADMIN_DATABASE_URL (the `app_platform_admin` role under test),
 * both distinct, the package built (dist/), and migration 0060 already applied
 * to the target DB. It self-skips rather than failing — exactly like the other
 * *.integration.test.ts suites here.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acceptStaffInvitationTx, claimCustomerInvitationTx, ensureApplicationUser } from "@academic-precision/database";

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PLATFORM_ADMIN_DATABASE_URL = process.env.PLATFORM_ADMIN_DATABASE_URL;
const DATABASE_URL = process.env.DATABASE_URL; // app_runtime — used by ensureApplicationUser
const distEntryPoint = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const hasLiveCreds =
  !!MIGRATION_DATABASE_URL &&
  !!PLATFORM_ADMIN_DATABASE_URL &&
  !!DATABASE_URL &&
  MIGRATION_DATABASE_URL !== PLATFORM_ADMIN_DATABASE_URL &&
  existsSync(distEntryPoint);

const hash = (raw: string) => createHash("sha256").update(raw).digest("hex");

// A unique suffix keeps fixtures isolated from any real data / parallel runs.
const RUN = randomUUID().slice(0, 8);
const staffUserId = randomUUID();
const custUserId = randomUUID();
const custWorkspaceId = randomUUID();
const staffToken = `staff-${RUN}`;
const custToken = `cust-${RUN}`;
const staffEmail = `staff-${RUN}@example.test`;
const custEmail = `cust-${RUN}@example.test`;

const d = hasLiveCreds ? describe : describe.skip;

d("platform invite acceptance (live app_platform_admin path)", () => {
  let admin: Sql;

  beforeAll(async () => {
    admin = postgres(MIGRATION_DATABASE_URL as string, { max: 1 });
    // Fixtures created with the privileged migration role (BYPASSRLS).
    // NOTE: the staff user row is deliberately NOT pre-created — the staff-accept
    // flow (ensureApplicationUser) must create it itself, and we then assert it
    // did so WITHOUT any tenant workspace / membership / trial.
    await admin`INSERT INTO users (id, full_name, email_display) VALUES (${custUserId}, ${"Placeholder Name"}, ${custEmail})`;
    await admin`INSERT INTO workspaces (id, owner_user_id, name) VALUES (${custWorkspaceId}, ${custUserId}, ${"Placeholder Workspace"})`;
    await admin`
      INSERT INTO platform_staff_invitations (email, token_hash, role, status, expires_at)
      VALUES (${staffEmail}, ${hash(staffToken)}, ${"OPERATIONS_ADMIN"}, ${"PENDING"}, now() + interval '7 days')`;
    await admin`
      INSERT INTO platform_customer_invitations (full_name, email, phone, token_hash, status, expires_at)
      VALUES (${"Real Customer"}, ${custEmail}, ${"01000000000"}, ${hash(custToken)}, ${"PENDING"}, now() + interval '14 days')`;
  });

  afterAll(async () => {
    if (!admin) return;
    await admin`DELETE FROM platform_admins WHERE user_id = ${staffUserId}`;
    await admin`DELETE FROM platform_staff_invitations WHERE email = ${staffEmail}`;
    await admin`DELETE FROM platform_customer_invitations WHERE email = ${custEmail}`;
    await admin`DELETE FROM platform_audit_events WHERE actor_user_id IN (${staffUserId}, ${custUserId})`;
    await admin`DELETE FROM workspaces WHERE id = ${custWorkspaceId}`;
    await admin`DELETE FROM users WHERE id IN (${staffUserId}, ${custUserId})`;
    await admin.end();
  });

  it("staff accept: ensures the users row + platform_admins, but NO workspace / membership / trial, then is single-use", async () => {
    // 1) Ensure ONLY the application user row (what the service does first).
    await ensureApplicationUser({ authUserId: staffUserId, email: staffEmail, fullName: "staff" });
    const userRows = await admin`SELECT id FROM users WHERE id = ${staffUserId}`;
    expect(userRows).toHaveLength(1);

    // 2) Accept — inserts platform_admins via the app_platform_admin connection.
    const res = await acceptStaffInvitationTx({ tokenHash: hash(staffToken), accepterUserId: staffUserId, accepterEmail: staffEmail });
    expect(res).toEqual({ ok: true, role: "OPERATIONS_ADMIN" });
    const admins = await admin`SELECT role, status FROM platform_admins WHERE user_id = ${staffUserId}`;
    expect(admins[0]).toMatchObject({ role: "OPERATIONS_ADMIN", status: "ACTIVE" });

    // 3) The staff member is NOT a tenant: no workspace, membership, trial, or subscription.
    const ws = await admin`SELECT count(*)::int AS n FROM workspaces WHERE owner_user_id = ${staffUserId}`;
    expect(ws[0].n).toBe(0);
    const mem = await admin`SELECT count(*)::int AS n FROM memberships WHERE user_id = ${staffUserId}`;
    expect(mem[0].n).toBe(0);
    const trial = await admin`SELECT count(*)::int AS n FROM owner_trial_grants WHERE first_user_id = ${staffUserId}`;
    expect(trial[0].n).toBe(0);
    const subs = await admin`
      SELECT count(*)::int AS n FROM subscriptions s
      JOIN workspaces w ON w.id = s.workspace_id WHERE w.owner_user_id = ${staffUserId}`;
    expect(subs[0].n).toBe(0);

    // 4) Re-accept the now-consumed invite → fails closed (single-use).
    const again = await acceptStaffInvitationTx({ tokenHash: hash(staffToken), accepterUserId: staffUserId, accepterEmail: staffEmail });
    expect(again).toEqual({ ok: false, reason: "ALREADY_ADMIN" });
  });

  it("staff accept rejects a mismatched authenticated email", async () => {
    // A fresh pending invite for a different address; wrong accepter email.
    await admin`
      INSERT INTO platform_staff_invitations (email, token_hash, role, status, expires_at)
      VALUES (${`other-${RUN}@example.test`}, ${hash(`other-${RUN}`)}, ${"SUPPORT_AGENT"}, ${"PENDING"}, now() + interval '7 days')`;
    const res = await acceptStaffInvitationTx({ tokenHash: hash(`other-${RUN}`), accepterUserId: staffUserId, accepterEmail: staffEmail });
    expect(res).toEqual({ ok: false, reason: "EMAIL_MISMATCH" });
    await admin`DELETE FROM platform_staff_invitations WHERE email = ${`other-${RUN}@example.test`}`;
  });

  it("customer claim: applies invited name + phone to users, renames workspace, links it, single-use", async () => {
    const res = await claimCustomerInvitationTx({ tokenHash: hash(custToken), accepterUserId: custUserId, accepterEmail: custEmail, workspaceId: custWorkspaceId });
    expect(res).toEqual({ ok: true, workspaceId: custWorkspaceId });

    const user = await admin`SELECT full_name, phone FROM users WHERE id = ${custUserId}`;
    expect(user[0]).toMatchObject({ full_name: "Real Customer", phone: "01000000000" });
    const ws = await admin`SELECT name FROM workspaces WHERE id = ${custWorkspaceId}`;
    expect(ws[0]).toMatchObject({ name: "Real Customer" });
    const inv = await admin`SELECT status, accepted_workspace_id FROM platform_customer_invitations WHERE email = ${custEmail}`;
    expect(inv[0]).toMatchObject({ status: "ACCEPTED", accepted_workspace_id: custWorkspaceId });

    // Re-claim is a no-op (single-use) — no second provisioning / re-apply.
    const again = await claimCustomerInvitationTx({ tokenHash: hash(custToken), accepterUserId: custUserId, accepterEmail: custEmail, workspaceId: custWorkspaceId });
    expect(again).toEqual({ ok: false, reason: "INVALID" });
  });
});
