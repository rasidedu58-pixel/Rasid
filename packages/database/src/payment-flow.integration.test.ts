/**
 * Billing Phase 3 — Payment Request → Confirm → Activation, real-Postgres.
 *
 * Mirrors `./platform-invite-acceptance.integration.test.ts`: uses THREE roles —
 * MIGRATION_DATABASE_URL (fixtures), DATABASE_URL (app_runtime: create), and
 * PLATFORM_ADMIN_DATABASE_URL (app_platform_admin: confirm/reject) — imports the
 * COMPILED entry, and self-skips without live creds + a build.
 *
 * HOW TO RUN (disposable/staging DB only — NEVER Production): apply migrations
 * incl. 0062–0065, build the package, set the three URLs, then `test`.
 */
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeDb,
  confirmPaymentRequestTransaction,
  createPaymentRequestTransaction,
  getPlatformAdminDb,
  rejectPaymentRequestTransaction,
  reverseSubscriptionPaymentTransaction,
  withRuntimeContext,
  PaymentRequestStaleError,
} from "@academic-precision/database";

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PLATFORM_ADMIN_DATABASE_URL = process.env.PLATFORM_ADMIN_DATABASE_URL;
const distEntryPoint = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const distBuilt = existsSync(distEntryPoint);
const hasLiveCreds = !!DATABASE_URL && !!MIGRATION_DATABASE_URL && !!PLATFORM_ADMIN_DATABASE_URL && DATABASE_URL !== MIGRATION_DATABASE_URL && distBuilt;

if (!hasLiveCreds) {
  // eslint-disable-next-line no-console
  console.warn("[payment-flow.integration.test] Skipping: requires DATABASE_URL + MIGRATION_DATABASE_URL + PLATFORM_ADMIN_DATABASE_URL on a disposable DB (migrations 0062–0065) + a build. Not a failure.");
}

describe.skipIf(!hasLiveCreds)("Billing Phase 3 — Payment flow (live Postgres)", () => {
  let admin: Sql;
  const wsId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();

  async function resetTrial() {
    await admin`DELETE FROM subscription_payment_reversals WHERE workspace_id = ${wsId}`;
    await admin`DELETE FROM subscription_payments WHERE workspace_id = ${wsId}`;
    await admin`DELETE FROM payment_requests WHERE workspace_id = ${wsId}`;
    await admin`DELETE FROM entitlements WHERE workspace_id = ${wsId}`;
    await admin`DELETE FROM subscriptions WHERE workspace_id = ${wsId}`;
    await admin`INSERT INTO subscriptions (workspace_id, state) VALUES (${wsId}, 'TRIAL')`;
  }

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    admin = postgres(MIGRATION_DATABASE_URL!, { max: 3 });
    await admin`INSERT INTO users (id, full_name, email_display, phone, status) VALUES (${userId}, 'Pay Owner', 'pay-owner@example.test', '01000000000', 'ACTIVE')`;
    await admin`INSERT INTO workspaces (id, owner_user_id, name, workspace_type, locale, timezone, due_date_policy, status) VALUES (${wsId}, ${userId}, 'Pay WS', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE')`;
    await admin`INSERT INTO memberships (id, workspace_id, user_id, role_label, status, joined_at) VALUES (${membershipId}, ${wsId}, ${userId}, 'OWNER', 'ACTIVE', now())`;
    await resetTrial();
  });

  afterAll(async () => {
    try {
      for (const t of ["subscription_payment_reversals", "subscription_payments", "payment_requests", "entitlements", "subscriptions", "notifications", "audit_events", "outbox_events", "memberships"]) {
        await admin.unsafe(`DELETE FROM ${t} WHERE workspace_id = $1`, [wsId]);
      }
      await admin`DELETE FROM workspaces WHERE id = ${wsId}`;
      await admin`DELETE FROM users WHERE id = ${userId}`;
    } finally {
      await admin.end({ timeout: 5 });
      await closeDb();
    }
  });

  const create = () =>
    withRuntimeContext({ userId, workspaceId: wsId }, (db) =>
      createPaymentRequestTransaction(db, { workspaceId: wsId, requestedByUserId: userId, planCode: "PROFESSIONAL", billingCycle: "MONTHLY", paymentMethod: "INSTAPAY" }),
    );

  it("creates a PENDING request priced from the catalog (server-computed, RSD code)", async () => {
    await resetTrial();
    const { paymentRequest } = await create();
    expect(paymentRequest.status).toBe("PENDING");
    expect(paymentRequest.amountMinor).toBe(30000); // PROFESSIONAL monthly — never a client value
    expect(paymentRequest.actionType).toBe("NEW_SUBSCRIPTION");
    expect(paymentRequest.humanCode).toMatch(/^RSD-[0-9A-Z]{5}$/);
  });

  it("confirm creates ONE immutable payment and activates the subscription with the commercial snapshot", async () => {
    await resetTrial();
    const { paymentRequest } = await create();
    await confirmPaymentRequestTransaction(getPlatformAdminDb(), { paymentRequestId: paymentRequest.id, confirmedByUserId: userId });

    const [sub] = await admin`SELECT * FROM subscriptions WHERE workspace_id = ${wsId}`;
    expect(sub!.state).toBe("ACTIVE");
    expect(sub!.plan_code).toBe("PROFESSIONAL");
    expect(sub!.billing_cycle).toBe("MONTHLY");
    expect(Number(sub!.current_price_minor)).toBe(30000);
    expect(sub!.period_end).not.toBeNull();
    const payments = await admin`SELECT * FROM subscription_payments WHERE payment_request_id = ${paymentRequest.id}`;
    expect(payments).toHaveLength(1);
    expect(payments[0]!.confirmation_source).toBe("MANUAL_ADMIN");
    const [req] = await admin`SELECT status FROM payment_requests WHERE id = ${paymentRequest.id}`;
    expect(req!.status).toBe("CONFIRMED");
  });

  it("double confirm is idempotent — still exactly one payment", async () => {
    await resetTrial();
    const { paymentRequest } = await create();
    await confirmPaymentRequestTransaction(getPlatformAdminDb(), { paymentRequestId: paymentRequest.id, confirmedByUserId: userId });
    await confirmPaymentRequestTransaction(getPlatformAdminDb(), { paymentRequestId: paymentRequest.id, confirmedByUserId: userId });
    const payments = await admin`SELECT id FROM subscription_payments WHERE payment_request_id = ${paymentRequest.id}`;
    expect(payments).toHaveLength(1);
  });

  it("a stale subscription version blocks confirmation (no partial activation)", async () => {
    await resetTrial();
    const { paymentRequest } = await create();
    // Simulate a concurrent subscription change after the quote was bound.
    await admin`UPDATE subscriptions SET version = version + 1 WHERE workspace_id = ${wsId}`;
    await expect(
      confirmPaymentRequestTransaction(getPlatformAdminDb(), { paymentRequestId: paymentRequest.id, confirmedByUserId: userId }),
    ).rejects.toBeInstanceOf(PaymentRequestStaleError);
    const payments = await admin`SELECT id FROM subscription_payments WHERE payment_request_id = ${paymentRequest.id}`;
    expect(payments).toHaveLength(0); // nothing posted
  });

  it("reject records the reason and never activates the subscription", async () => {
    await resetTrial();
    const { paymentRequest } = await create();
    await rejectPaymentRequestTransaction(getPlatformAdminDb(), { paymentRequestId: paymentRequest.id, rejectedByUserId: userId, reason: "لم يصل التحويل" });
    const [req] = await admin`SELECT status, reject_reason FROM payment_requests WHERE id = ${paymentRequest.id}`;
    expect(req!.status).toBe("REJECTED");
    expect(req!.reject_reason).toBe("لم يصل التحويل");
    const [sub] = await admin`SELECT state FROM subscriptions WHERE workspace_id = ${wsId}`;
    expect(sub!.state).toBe("TRIAL"); // unchanged
    const payments = await admin`SELECT id FROM subscription_payments WHERE payment_request_id = ${paymentRequest.id}`;
    expect(payments).toHaveLength(0);
  });

  it("ACTIVE early renewal extends from the current paid-through date — no lost days, always one cycle", async () => {
    await resetTrial();
    // Make it a paid ACTIVE PROFESSIONAL/monthly subscription ending 2026-12-31.
    await admin`UPDATE subscriptions SET state='ACTIVE', plan_code='PROFESSIONAL', billing_cycle='MONTHLY', current_price_minor=30000, price_currency_code='EGP', plan_price_version=1, period_start='2026-11-30T00:00:00Z', period_end='2026-12-31T00:00:00Z' WHERE workspace_id = ${wsId}`;
    const { paymentRequest } = await create(); // RENEWAL (same plan)
    expect(paymentRequest.actionType).toBe("RENEWAL");
    await confirmPaymentRequestTransaction(getPlatformAdminDb(), { paymentRequestId: paymentRequest.id, confirmedByUserId: userId });
    const [sub] = await admin`SELECT period_start, period_end FROM subscriptions WHERE workspace_id = ${wsId}`;
    expect(new Date(sub!.period_start as string).toISOString()).toBe("2026-12-31T00:00:00.000Z"); // extends from old end
    expect(new Date(sub!.period_end as string).toISOString()).toBe("2027-01-31T00:00:00.000Z"); // +1 month, remaining days preserved
  });

  it("tenant may cancel its OWN PENDING request, but the DB blocks cancelling a CONFIRMED/REJECTED one", async () => {
    await resetTrial();
    // PENDING → CANCELLED allowed (tenant, app_runtime).
    const { paymentRequest: pending } = await create();
    const cancelled = await withRuntimeContext({ userId, workspaceId: wsId }, (db) =>
      db.execute(sql`UPDATE payment_requests SET status='CANCELLED', version=version+1 WHERE id=${pending.id} RETURNING id`),
    );
    expect(cancelled.length).toBe(1);

    // CONFIRMED → CANCELLED denied (USING status='PENDING' filters it out → 0 rows, status unchanged).
    await resetTrial();
    const { paymentRequest: toConfirm } = await create();
    await confirmPaymentRequestTransaction(getPlatformAdminDb(), { paymentRequestId: toConfirm.id, confirmedByUserId: userId });
    const blockedConfirmed = await withRuntimeContext({ userId, workspaceId: wsId }, (db) =>
      db.execute(sql`UPDATE payment_requests SET status='CANCELLED', version=version+1 WHERE id=${toConfirm.id} RETURNING id`),
    );
    expect(blockedConfirmed.length).toBe(0);
    const [stillConfirmed] = await admin`SELECT status FROM payment_requests WHERE id=${toConfirm.id}`;
    expect(stillConfirmed!.status).toBe("CONFIRMED");

    // REJECTED → CANCELLED denied.
    await resetTrial();
    const { paymentRequest: toReject } = await create();
    await rejectPaymentRequestTransaction(getPlatformAdminDb(), { paymentRequestId: toReject.id, rejectedByUserId: userId, reason: "x" });
    const blockedRejected = await withRuntimeContext({ userId, workspaceId: wsId }, (db) =>
      db.execute(sql`UPDATE payment_requests SET status='CANCELLED', version=version+1 WHERE id=${toReject.id} RETURNING id`),
    );
    expect(blockedRejected.length).toBe(0);
  });

  it("the original payment is never mutated on reversal; a second reversal is blocked", async () => {
    await resetTrial();
    const { paymentRequest } = await create();
    await confirmPaymentRequestTransaction(getPlatformAdminDb(), { paymentRequestId: paymentRequest.id, confirmedByUserId: userId });
    const [payment] = await admin`SELECT id, created_at FROM subscription_payments WHERE payment_request_id = ${paymentRequest.id}`;

    await reverseSubscriptionPaymentTransaction(getPlatformAdminDb(), { paymentId: payment!.id as string, reversedByUserId: userId, reason: "خطأ" });
    const [afterReversal] = await admin`SELECT created_at FROM subscription_payments WHERE id = ${payment!.id}`;
    expect(afterReversal!.created_at).toEqual(payment!.created_at); // untouched

    // Derived "reversed" state = a reversal row exists.
    const reversals = await admin`SELECT id FROM subscription_payment_reversals WHERE payment_id = ${payment!.id}`;
    expect(reversals).toHaveLength(1);

    // A second reversal is blocked by the UNIQUE(payment_id).
    await expect(
      reverseSubscriptionPaymentTransaction(getPlatformAdminDb(), { paymentId: payment!.id as string, reversedByUserId: userId, reason: "مكرر" }),
    ).rejects.toBeTruthy();
    const stillOne = await admin`SELECT id FROM subscription_payment_reversals WHERE payment_id = ${payment!.id}`;
    expect(stillOne).toHaveLength(1);
  });
});
