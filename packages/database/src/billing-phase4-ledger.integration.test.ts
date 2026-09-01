/**
 * Billing Phase 4 — subscription_periods ledger + upgrade proration + scheduled
 * downgrade, real-Postgres. Mirrors payment-flow.integration.test.ts: three
 * roles, compiled entry, self-skips without live creds + a build.
 *
 * HOW TO RUN (disposable/staging DB only — NEVER Production): apply migrations
 * incl. 0062–0066, build the package, set the three URLs, then `test`.
 */
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeDb,
  confirmPaymentRequestTransaction,
  createPaymentRequestTransaction,
  getPlatformAdminDb,
  scheduleDowngradeTransaction,
  cancelScheduledDowngradeTransaction,
  quoteUpgradeForWorkspace,
  loadBillingPlanState,
  runPeriodAdvance,
  getWorkerDb,
  withRuntimeContext,
  NotAnUpgradeError,
  FuturePlanChangeExistsError,
  NoPendingDowngradeError,
} from "@academic-precision/database";

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PLATFORM_ADMIN_DATABASE_URL = process.env.PLATFORM_ADMIN_DATABASE_URL;
const WORKER_DATABASE_URL = process.env.WORKER_DATABASE_URL;
const distEntryPoint = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const distBuilt = existsSync(distEntryPoint);
const hasLiveCreds =
  !!DATABASE_URL && !!MIGRATION_DATABASE_URL && !!PLATFORM_ADMIN_DATABASE_URL && !!WORKER_DATABASE_URL && DATABASE_URL !== MIGRATION_DATABASE_URL && distBuilt;

if (!hasLiveCreds) {
  // eslint-disable-next-line no-console
  console.warn(
    "[billing-phase4-ledger.integration.test] Skipping: requires DATABASE_URL + MIGRATION_DATABASE_URL + PLATFORM_ADMIN_DATABASE_URL + WORKER_DATABASE_URL on a disposable DB (migrations 0062–0066) + a build. Not a failure.",
  );
}

describe.skipIf(!hasLiveCreds)("Billing Phase 4 — period ledger + upgrade + downgrade (live Postgres)", () => {
  let admin: Sql;
  const wsId = randomUUID();
  const userId = randomUUID();

  async function seedActiveProfessional() {
    await admin`DELETE FROM subscription_periods WHERE workspace_id = ${wsId}`;
    await admin`DELETE FROM subscription_payment_reversals WHERE workspace_id = ${wsId}`;
    await admin`DELETE FROM subscription_payments WHERE workspace_id = ${wsId}`;
    await admin`DELETE FROM payment_requests WHERE workspace_id = ${wsId}`;
    await admin`DELETE FROM entitlements WHERE workspace_id = ${wsId}`;
    await admin`DELETE FROM subscriptions WHERE workspace_id = ${wsId}`;
    // ACTIVE PROFESSIONAL, monthly, one cycle now..+30d (no ledger row yet — backfill-on-read covers it).
    const now = new Date();
    const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    await admin`INSERT INTO subscriptions (workspace_id, state, plan_code, billing_cycle, current_price_minor, price_currency_code, plan_price_version, period_start, period_end)
      VALUES (${wsId}, 'ACTIVE', 'PROFESSIONAL', 'MONTHLY', 30000, 'EGP', 1, ${now}, ${end})`;
  }

  beforeAll(async () => {
    admin = postgres(MIGRATION_DATABASE_URL!, { max: 3 });
    await admin`INSERT INTO users (id, full_name) VALUES (${userId}, 'P4 LEDGER TEST') ON CONFLICT DO NOTHING`;
    await admin`INSERT INTO workspaces (id, owner_user_id, name) VALUES (${wsId}, ${userId}, 'P4 LEDGER TEST WS') ON CONFLICT DO NOTHING`;
  });

  afterAll(async () => {
    await admin`DELETE FROM subscription_periods WHERE workspace_id = ${wsId}`;
    await admin`DELETE FROM subscription_payments WHERE workspace_id = ${wsId}`;
    await admin`DELETE FROM payment_requests WHERE workspace_id = ${wsId}`;
    await admin`DELETE FROM entitlements WHERE workspace_id = ${wsId}`;
    await admin`DELETE FROM subscriptions WHERE workspace_id = ${wsId}`;
    await admin`DELETE FROM workspaces WHERE id = ${wsId}`;
    await admin`DELETE FROM users WHERE id = ${userId}`;
    await admin.end();
    await closeDb();
  });

  it("UPGRADE: proration is a positive DIFF, confirm appends supersession rows, aggregate flips immediately, period_end unchanged, one payment", async () => {
    await seedActiveProfessional();
    const platformDb = getPlatformAdminDb();

    // Customer (owner) creates the UPGRADE request (server-priced).
    const created = await withRuntimeContext({ workspaceId: wsId, userId }, (db) =>
      createPaymentRequestTransaction(db, { workspaceId: wsId, requestedByUserId: userId, planCode: "ADVANCED", billingCycle: "MONTHLY", paymentMethod: "INSTAPAY" }),
    );
    expect(created.paymentRequest.actionType).toBe("UPGRADE");
    expect(created.paymentRequest.amountMinor).toBeGreaterThan(0);
    expect(created.paymentRequest.amountMinor).toBeLessThanOrEqual(15000); // ≤ full monthly diff

    const [subBefore] = await admin`SELECT period_end FROM subscriptions WHERE workspace_id = ${wsId}`;

    await confirmPaymentRequestTransaction(platformDb, { paymentRequestId: created.paymentRequest.id, confirmedByUserId: userId });

    const [sub] = await admin`SELECT plan_code, current_price_minor, period_end FROM subscriptions WHERE workspace_id = ${wsId}`;
    expect(sub.plan_code).toBe("ADVANCED"); // immediate
    expect(Number(sub.current_price_minor)).toBe(45000);
    expect(new Date(sub.period_end).getTime()).toBe(new Date(subBefore.period_end).getTime()); // unchanged
    const payments = await admin`SELECT count(*)::int n FROM subscription_payments WHERE workspace_id = ${wsId}`;
    expect(payments[0].n).toBe(1);
    const upgradeRows = await admin`SELECT count(*)::int n FROM subscription_periods WHERE workspace_id = ${wsId} AND source_action = 'UPGRADE'`;
    expect(upgradeRows[0].n).toBeGreaterThanOrEqual(1);
  });

  it("DOWNGRADE requested via the payment endpoint is rejected (NOT_AN_UPGRADE)", async () => {
    await seedActiveProfessional();
    await expect(
      withRuntimeContext({ workspaceId: wsId, userId }, (db) =>
        createPaymentRequestTransaction(db, { workspaceId: wsId, requestedByUserId: userId, planCode: "STARTER", billingCycle: "MONTHLY", paymentMethod: "INSTAPAY" }),
      ),
    ).rejects.toBeInstanceOf(NotAnUpgradeError);
  });

  it("schedule downgrade sets pending; cancel clears it; the current plan never changes", async () => {
    await seedActiveProfessional();
    await withRuntimeContext({ workspaceId: wsId, userId }, (db) =>
      scheduleDowngradeTransaction(db, { workspaceId: wsId, requestedByUserId: userId, targetPlanCode: "STARTER" }),
    );
    const [pending] = await admin`SELECT plan_code, pending_plan_code FROM subscriptions WHERE workspace_id = ${wsId}`;
    expect(pending.plan_code).toBe("PROFESSIONAL"); // unchanged now
    expect(pending.pending_plan_code).toBe("STARTER");

    await withRuntimeContext({ workspaceId: wsId, userId }, (db) => cancelScheduledDowngradeTransaction(db, { workspaceId: wsId, actorUserId: userId }));
    const [cleared] = await admin`SELECT pending_plan_code FROM subscriptions WHERE workspace_id = ${wsId}`;
    expect(cleared.pending_plan_code).toBeNull();
  });

  it("the period ledger is immutable: NO app role has UPDATE or DELETE on subscription_periods", async () => {
    const grants = await admin`
      SELECT grantee, privilege_type FROM information_schema.role_table_grants
      WHERE table_name = 'subscription_periods'
        AND grantee IN ('app_runtime','app_worker','app_platform_admin')
        AND privilege_type IN ('UPDATE','DELETE')`;
    expect(grants.length).toBe(0);
  });

  it("worker period-advance promotes a due future lower-plan period into the aggregate (no free cycle)", async () => {
    await seedActiveProfessional();
    // Append (as admin) a CURRENT ADVANCED period and a FUTURE PROFESSIONAL period that is already due.
    const now = Date.now();
    const [subRow] = await admin`SELECT id FROM subscriptions WHERE workspace_id = ${wsId}`;
    await admin`UPDATE subscriptions SET plan_code='ADVANCED', current_price_minor=45000 WHERE workspace_id = ${wsId}`;
    const pastStart = new Date(now - 40 * 24 * 60 * 60 * 1000);
    const boundary = new Date(now - 1 * 24 * 60 * 60 * 1000); // already crossed
    const futureEnd = new Date(now + 20 * 24 * 60 * 60 * 1000);
    await admin`INSERT INTO subscription_periods (workspace_id, subscription_id, plan_code, billing_cycle, cycle_price_minor, currency_code, plan_price_version, period_start, period_end, nominal_cycle_start, nominal_cycle_end, source_action)
      VALUES (${wsId}, ${subRow.id}, 'ADVANCED', 'MONTHLY', 45000, 'EGP', 1, ${pastStart}, ${boundary}, ${pastStart}, ${boundary}, 'RENEWAL')`;
    await admin`INSERT INTO subscription_periods (workspace_id, subscription_id, plan_code, billing_cycle, cycle_price_minor, currency_code, plan_price_version, period_start, period_end, nominal_cycle_start, nominal_cycle_end, source_action)
      VALUES (${wsId}, ${subRow.id}, 'PROFESSIONAL', 'MONTHLY', 30000, 'EGP', 1, ${boundary}, ${futureEnd}, ${boundary}, ${futureEnd}, 'RENEWAL')`;

    const advanced = await runPeriodAdvance(getWorkerDb(), new Date(now));
    expect(advanced).toBeGreaterThanOrEqual(1);
    const [sub] = await admin`SELECT plan_code, current_price_minor FROM subscriptions WHERE workspace_id = ${wsId}`;
    expect(sub.plan_code).toBe("PROFESSIONAL"); // promoted at boundary
    expect(Number(sub.current_price_minor)).toBe(30000);

    // Idempotent: a second scan advances nothing.
    const again = await runPeriodAdvance(getWorkerDb(), new Date(now));
    expect(again).toBe(0);
  });

  it("read-only quote/plan-state NEVER writes a subscription_periods row", async () => {
    await seedActiveProfessional();
    const [before] = await admin`SELECT count(*)::int n FROM subscription_periods WHERE workspace_id = ${wsId}`;
    await withRuntimeContext({ workspaceId: wsId, userId }, (db) => quoteUpgradeForWorkspace(db, { workspaceId: wsId, targetPlanCode: "ADVANCED", billingCycle: "MONTHLY" }));
    await withRuntimeContext({ workspaceId: wsId, userId }, (db) => loadBillingPlanState(db, wsId));
    const [after] = await admin`SELECT count(*)::int n FROM subscription_periods WHERE workspace_id = ${wsId}`;
    expect(after.n).toBe(before.n); // no write-on-read
  });

  it("same-plan stacked future prepaid periods → upgrade ALLOWED", async () => {
    await seedActiveProfessional();
    const [subRow] = await admin`SELECT id FROM subscriptions WHERE workspace_id = ${wsId}`;
    const now = Date.now();
    const s0 = new Date(now), e0 = new Date(now + 30 * 864e5), e1 = new Date(now + 60 * 864e5);
    await admin`INSERT INTO subscription_periods (workspace_id, subscription_id, plan_code, billing_cycle, cycle_price_minor, currency_code, plan_price_version, period_start, period_end, nominal_cycle_start, nominal_cycle_end, source_action)
      VALUES (${wsId}, ${subRow.id}, 'PROFESSIONAL', 'MONTHLY', 30000, 'EGP', 1, ${s0}, ${e0}, ${s0}, ${e0}, 'NEW_SUBSCRIPTION')`;
    await admin`INSERT INTO subscription_periods (workspace_id, subscription_id, plan_code, billing_cycle, cycle_price_minor, currency_code, plan_price_version, period_start, period_end, nominal_cycle_start, nominal_cycle_end, source_action)
      VALUES (${wsId}, ${subRow.id}, 'PROFESSIONAL', 'MONTHLY', 30000, 'EGP', 1, ${e0}, ${e1}, ${e0}, ${e1}, 'RENEWAL')`;
    const quote = await withRuntimeContext({ workspaceId: wsId, userId }, (db) => quoteUpgradeForWorkspace(db, { workspaceId: wsId, targetPlanCode: "ADVANCED", billingCycle: "MONTHLY" }));
    expect(quote.eligible).toBe(true);
    expect(quote.amountDueMinor).toBeGreaterThan(0);
  });

  it("mixed-plan future PAID period → upgrade BLOCKED (FUTURE_PLAN_CHANGE_EXISTS), no ledger/payment/subscription mutation", async () => {
    await seedActiveProfessional();
    const [subRow] = await admin`SELECT id FROM subscriptions WHERE workspace_id = ${wsId}`;
    await admin`UPDATE subscriptions SET plan_code='ADVANCED', current_price_minor=45000 WHERE workspace_id = ${wsId}`;
    const now = Date.now();
    const s0 = new Date(now), e0 = new Date(now + 30 * 864e5), e1 = new Date(now + 60 * 864e5);
    await admin`INSERT INTO subscription_periods (workspace_id, subscription_id, plan_code, billing_cycle, cycle_price_minor, currency_code, plan_price_version, period_start, period_end, nominal_cycle_start, nominal_cycle_end, source_action)
      VALUES (${wsId}, ${subRow.id}, 'ADVANCED', 'MONTHLY', 45000, 'EGP', 1, ${s0}, ${e0}, ${s0}, ${e0}, 'NEW_SUBSCRIPTION')`;
    await admin`INSERT INTO subscription_periods (workspace_id, subscription_id, plan_code, billing_cycle, cycle_price_minor, currency_code, plan_price_version, period_start, period_end, nominal_cycle_start, nominal_cycle_end, source_action)
      VALUES (${wsId}, ${subRow.id}, 'PROFESSIONAL', 'MONTHLY', 30000, 'EGP', 1, ${e0}, ${e1}, ${e0}, ${e1}, 'RENEWAL')`;

    const [beforePeriods] = await admin`SELECT count(*)::int n FROM subscription_periods WHERE workspace_id = ${wsId}`;

    // Read-only quote reports not-eligible with the exact reason.
    const quote = await withRuntimeContext({ workspaceId: wsId, userId }, (db) => quoteUpgradeForWorkspace(db, { workspaceId: wsId, targetPlanCode: "BUSINESS", billingCycle: "MONTHLY" }));
    expect(quote.eligible).toBe(false);
    expect(quote.reason).toBe("FUTURE_PLAN_CHANGE_EXISTS");

    // Create is rejected BEFORE any PaymentRequest is created.
    await expect(
      withRuntimeContext({ workspaceId: wsId, userId }, (db) =>
        createPaymentRequestTransaction(db, { workspaceId: wsId, requestedByUserId: userId, planCode: "BUSINESS", billingCycle: "MONTHLY", paymentMethod: "INSTAPAY" }),
      ),
    ).rejects.toBeInstanceOf(FuturePlanChangeExistsError);

    const [afterPeriods] = await admin`SELECT count(*)::int n FROM subscription_periods WHERE workspace_id = ${wsId}`;
    const [payments] = await admin`SELECT count(*)::int n FROM subscription_payments WHERE workspace_id = ${wsId}`;
    const [requests] = await admin`SELECT count(*)::int n FROM payment_requests WHERE workspace_id = ${wsId} AND status='PENDING'`;
    expect(afterPeriods.n).toBe(beforePeriods.n); // ledger untouched
    expect(payments.n).toBe(0);
    expect(requests.n).toBe(0);
  });

  it("a PAID future lower-plan period cannot be removed via the pending-downgrade endpoint", async () => {
    await seedActiveProfessional();
    const [subRow] = await admin`SELECT id FROM subscriptions WHERE workspace_id = ${wsId}`;
    const now = Date.now();
    const e0 = new Date(now + 30 * 864e5), e1 = new Date(now + 60 * 864e5);
    // A paid future PROFESSIONAL->STARTER period exists; pending columns are already CLEARED (consumed at renewal).
    await admin`INSERT INTO subscription_periods (workspace_id, subscription_id, plan_code, billing_cycle, cycle_price_minor, currency_code, plan_price_version, period_start, period_end, nominal_cycle_start, nominal_cycle_end, source_action)
      VALUES (${wsId}, ${subRow.id}, 'STARTER', 'MONTHLY', 10000, 'EGP', 1, ${e0}, ${e1}, ${e0}, ${e1}, 'RENEWAL')`;
    // No pending row → cancel has nothing to cancel, and the paid future period must remain.
    await expect(
      withRuntimeContext({ workspaceId: wsId, userId }, (db) => cancelScheduledDowngradeTransaction(db, { workspaceId: wsId, actorUserId: userId })),
    ).rejects.toBeInstanceOf(NoPendingDowngradeError);
    const [futures] = await admin`SELECT count(*)::int n FROM subscription_periods WHERE workspace_id = ${wsId} AND plan_code='STARTER'`;
    expect(futures.n).toBe(1); // ledger unchanged by the pending endpoint
  });

  it("required worker due-period index exists in the schema", async () => {
    const idx = await admin`SELECT indexname FROM pg_indexes WHERE tablename='subscription_periods' AND indexname='subscription_periods_active_at_idx'`;
    expect(idx.length).toBe(1);
  });
});
