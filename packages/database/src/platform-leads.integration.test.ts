/**
 * Platform Leads — real-Postgres integration test (Phase 16 Part B).
 *
 * Proves, against a LIVE database through the REAL production connections:
 *   - the signup hook `insertLeadForNewWorkspaceTx` runs as `app_runtime`
 *     (INSERT-only grant) and is idempotent on workspace_id (no duplicate lead
 *     on a retried / racing provision),
 *   - the console reads (`listPlatformLeads`, `getPlatformLeadMetrics`) run on
 *     `app_platform_admin` and LIVE-JOIN the owner's name / phone / email +
 *     subscription hint — NONE of which is stored on the lead row,
 *   - `updatePlatformLead` edits only the follow-up columns and appends a
 *     platform audit event in the same transaction,
 *   - the filters (NEW / needs-follow-up) and search resolve correctly.
 *
 * SKIPS ENTIRELY without live creds (CI / credential-free machines): requires
 *   - MIGRATION_DATABASE_URL      (privileged `postgres`, BYPASSRLS) for fixtures,
 *   - DATABASE_URL                (the `app_runtime` role — the signup hook),
 *   - PLATFORM_ADMIN_DATABASE_URL (the `app_platform_admin` role — the console),
 * the package built (dist/), and migration 0072 already applied to the target.
 * It self-skips rather than failing — exactly like the other *.integration.test.ts.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getPlatformLeadMetrics,
  insertLeadForNewWorkspaceTx,
  listPlatformLeads,
  updatePlatformLead,
} from "@academic-precision/database";

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const DATABASE_URL = process.env.DATABASE_URL; // app_runtime
const PLATFORM_ADMIN_DATABASE_URL = process.env.PLATFORM_ADMIN_DATABASE_URL;
const distEntryPoint = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const hasLiveCreds =
  !!MIGRATION_DATABASE_URL &&
  !!DATABASE_URL &&
  !!PLATFORM_ADMIN_DATABASE_URL &&
  MIGRATION_DATABASE_URL !== PLATFORM_ADMIN_DATABASE_URL &&
  existsSync(distEntryPoint);

const RUN = randomUUID().slice(0, 8);
const ownerId = randomUUID();
const workspaceId = randomUUID();
const adminActorId = randomUUID();
const ownerName = `عميل ${RUN}`;
const ownerPhone = `0101${RUN.replace(/\D/g, "0").slice(0, 7)}`;
const ownerEmail = `lead-${RUN}@example.test`;

const d = hasLiveCreds ? describe : describe.skip;

d("platform leads (live signup hook + console)", () => {
  let admin: Sql;
  let runtimeSql: Sql;

  beforeAll(async () => {
    admin = postgres(MIGRATION_DATABASE_URL as string, { max: 1 });
    runtimeSql = postgres(DATABASE_URL as string, { max: 1 });

    // Fixtures via the privileged role (BYPASSRLS): a signed-up owner + their
    // workspace + a TRIAL subscription (the read-time hint source) + the admin
    // actor who will later edit the lead.
    await admin`INSERT INTO users (id, full_name, email_display, phone) VALUES (${ownerId}, ${ownerName}, ${ownerEmail}, ${ownerPhone})`;
    await admin`INSERT INTO users (id, full_name, email_display) VALUES (${adminActorId}, ${`راصد ${RUN}`}, ${`admin-${RUN}@rasid.test`})`;
    await admin`INSERT INTO workspaces (id, owner_user_id, name) VALUES (${workspaceId}, ${ownerId}, ${`حلقة ${RUN}`})`;
    await admin`INSERT INTO subscriptions (workspace_id, state, plan_code, period_end) VALUES (${workspaceId}, ${"TRIAL"}, ${null}, now() + interval '14 days')`;
  });

  afterAll(async () => {
    if (admin) {
      await admin`DELETE FROM platform_audit_events WHERE actor_user_id = ${adminActorId}`;
      await admin`DELETE FROM platform_leads WHERE workspace_id = ${workspaceId}`;
      await admin`DELETE FROM subscriptions WHERE workspace_id = ${workspaceId}`;
      await admin`DELETE FROM workspaces WHERE id = ${workspaceId}`;
      await admin`DELETE FROM users WHERE id IN (${ownerId}, ${adminActorId})`;
      await admin.end();
    }
    if (runtimeSql) await runtimeSql.end();
  });

  it("signup hook creates exactly one lead (app_runtime, INSERT-only) and is idempotent", async () => {
    const runtimeDb = drizzle(runtimeSql);
    // Two provisions of the same workspace (retry / race) → still ONE lead.
    await runtimeDb.transaction((tx) => insertLeadForNewWorkspaceTx(tx as never, { workspaceId, ownerUserId: ownerId }));
    await runtimeDb.transaction((tx) => insertLeadForNewWorkspaceTx(tx as never, { workspaceId, ownerUserId: ownerId }));

    const rows = await admin`SELECT status FROM platform_leads WHERE workspace_id = ${workspaceId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("NEW");
  });

  it("the lead row stores NO PII columns (name/phone/email joined live only)", async () => {
    const cols = await admin`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'platform_leads'`;
    const names = cols.map((c) => c.column_name as string);
    expect(names).not.toContain("full_name");
    expect(names).not.toContain("phone");
    expect(names).not.toContain("email");
    expect(names).not.toContain("email_display");
    expect(names).toEqual(
      expect.arrayContaining(["workspace_id", "owner_user_id", "status", "next_follow_up_at", "note"]),
    );
  });

  it("console list live-joins identity + subscription hint and matches search / NEW filter", async () => {
    const all = await listPlatformLeads({});
    const mine = all.items.find((l) => l.workspaceId === workspaceId);
    expect(mine).toBeDefined();
    expect(mine!.ownerName).toBe(ownerName);
    expect(mine!.ownerPhone).toBe(ownerPhone);
    expect(mine!.ownerEmail).toBe(ownerEmail);
    expect(mine!.subscriptionState).toBe("TRIAL");
    expect(mine!.trialEndsAt).not.toBeNull();

    const byStatus = await listPlatformLeads({ statuses: ["NEW"] });
    expect(byStatus.items.some((l) => l.workspaceId === workspaceId)).toBe(true);

    const bySearch = await listPlatformLeads({ search: ownerEmail });
    expect(bySearch.items.some((l) => l.workspaceId === workspaceId)).toBe(true);

    const noMatch = await listPlatformLeads({ search: `zzz-${RUN}-nomatch` });
    expect(noMatch.items.some((l) => l.workspaceId === workspaceId)).toBe(false);
  });

  it("update edits follow-up columns, stamps the editor, and writes an audit event", async () => {
    const lead = (await listPlatformLeads({})).items.find((l) => l.workspaceId === workspaceId)!;
    const followUp = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();

    const updated = await updatePlatformLead({
      id: lead.id,
      actorUserId: adminActorId,
      status: "FOLLOW_UP",
      note: "اتصلت، طلب معاودة بعد ٣ أيام",
      nextFollowUpAt: new Date(followUp),
      markContactedNow: true,
    });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("FOLLOW_UP");
    expect(updated!.note).toContain("معاودة");
    expect(updated!.nextFollowUpAt).not.toBeNull();
    expect(updated!.lastContactAt).not.toBeNull();

    // The audit row is written in the same transaction.
    const audit = await admin`
      SELECT action, target_type FROM platform_audit_events
      WHERE actor_user_id = ${adminActorId} AND target_id = ${lead.id}`;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "platform.lead.updated", target_type: "platform_lead" });

    // The needs-follow-up filter now catches it.
    const nf = await listPlatformLeads({ needsFollowUp: true });
    expect(nf.items.some((l) => l.workspaceId === workspaceId)).toBe(true);
  });

  it("metrics count this lead", async () => {
    const m = await getPlatformLeadMetrics();
    expect(m.total).toBeGreaterThanOrEqual(1);
    expect(m.needsFollowUp).toBeGreaterThanOrEqual(1);
  });
});
