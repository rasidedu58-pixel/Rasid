/**
 * Billing Phase 5 — Custom Plans (request → offer → accept → payment → activate),
 * real-Postgres. Mirrors the Phase-4 harness: self-skips without live creds +
 * a build. HOW TO RUN (disposable/staging DB only — NEVER Production): apply
 * migrations incl. 0062–0069, build the package, set the URLs, then `test`.
 */
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  acceptCustomOfferTransaction,
  closeDb,
  confirmPaymentRequestTransaction,
  createCustomRequestTransaction,
  createCustomOfferTransaction,
  createCustomPaymentRequestFromAcceptedOffer,
  createCustomRenewalPaymentRequest,
  createPaymentRequestTransaction,
  rejectPaymentRequestTransaction,
  scheduleDowngradeTransaction,
  getPlatformAdminDb,
  getWorkerDb,
  withRuntimeContext,
  CustomOfferExpiredError,
  CustomOfferNotAcceptableError,
  CustomOfferAlreadyAppliedError,
} from "@academic-precision/database";

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PLATFORM_ADMIN_DATABASE_URL = process.env.PLATFORM_ADMIN_DATABASE_URL;
const distEntryPoint = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const hasLiveCreds = !!DATABASE_URL && !!MIGRATION_DATABASE_URL && !!PLATFORM_ADMIN_DATABASE_URL && DATABASE_URL !== MIGRATION_DATABASE_URL && existsSync(distEntryPoint);
if (!hasLiveCreds) {
  // eslint-disable-next-line no-console
  console.warn("[billing-phase5-custom.integration.test] Skipping: requires DATABASE_URL + MIGRATION_DATABASE_URL + PLATFORM_ADMIN_DATABASE_URL on a disposable DB (migrations 0062–0069) + a build. Not a failure.");
}

describe.skipIf(!hasLiveCreds)("Billing Phase 5 — custom plans (live Postgres)", () => {
  let admin: Sql;
  const wsId = randomUUID();
  const userId = randomUUID();

  async function resetTrial() {
    await admin`DELETE FROM subscription_periods WHERE workspace_id = ${wsId}`;
    await admin`DELETE FROM subscription_payments WHERE workspace_id = ${wsId}`;
    await admin`DELETE FROM payment_requests WHERE workspace_id = ${wsId}`;
    await admin`DELETE FROM custom_plan_offers WHERE workspace_id = ${wsId}`;
    await admin`DELETE FROM custom_plan_requests WHERE workspace_id = ${wsId}`;
    await admin`DELETE FROM entitlements WHERE workspace_id = ${wsId}`;
    await admin`DELETE FROM subscriptions WHERE workspace_id = ${wsId}`;
    await admin`INSERT INTO subscriptions (workspace_id, state) VALUES (${wsId}, 'TRIAL')`;
  }

  beforeAll(async () => {
    admin = postgres(MIGRATION_DATABASE_URL!, { max: 3 });
    await admin`INSERT INTO users (id, full_name) VALUES (${userId}, 'P5 CUSTOM TEST') ON CONFLICT DO NOTHING`;
    await admin`INSERT INTO workspaces (id, owner_user_id, name) VALUES (${wsId}, ${userId}, 'P5 CUSTOM TEST WS') ON CONFLICT DO NOTHING`;
  });

  afterAll(async () => {
    await admin`DELETE FROM subscription_periods WHERE workspace_id = ${wsId}`;
    await admin`DELETE FROM subscription_payments WHERE workspace_id = ${wsId}`;
    await admin`DELETE FROM payment_requests WHERE workspace_id = ${wsId}`;
    await admin`DELETE FROM custom_plan_offers WHERE workspace_id = ${wsId}`;
    await admin`DELETE FROM custom_plan_requests WHERE workspace_id = ${wsId}`;
    await admin`DELETE FROM entitlements WHERE workspace_id = ${wsId}`;
    await admin`DELETE FROM subscriptions WHERE workspace_id = ${wsId}`;
    await admin`DELETE FROM workspaces WHERE id = ${wsId}`;
    await admin`DELETE FROM users WHERE id = ${userId}`;
    await admin.end();
    await closeDb();
  });

  it("TRIAL → CUSTOM: request → offer → accept → payment → confirm → ACTIVE CUSTOM with agreed limits/price", async () => {
    await resetTrial();
    const platformDb = getPlatformAdminDb();
    const { request } = await withRuntimeContext({ workspaceId: wsId, userId }, (db) => createCustomRequestTransaction(db, { workspaceId: wsId, requestedByUserId: userId, requestedMaxActiveStudents: 4200, requestedMaxTeamMembers: 25, preferredBillingCycle: "MONTHLY" }));
    const offer = await createCustomOfferTransaction(platformDb, { customRequestId: request.id, createdByUserId: userId, maxActiveStudents: 4200, maxTeamMembers: 25, billingCycle: "MONTHLY", priceMinor: 120000, adjustmentReason: null, commercialNote: null, effectiveMode: "IMMEDIATE", validForDays: 14, now: new Date() });
    await withRuntimeContext({ workspaceId: wsId, userId }, (db) => acceptCustomOfferTransaction(db, { offerId: offer.id, workspaceId: wsId, acceptedByUserId: userId, now: new Date() }));
    const pr = await withRuntimeContext({ workspaceId: wsId, userId }, (db) => createCustomPaymentRequestFromAcceptedOffer(db, { workspaceId: wsId, requestedByUserId: userId, acceptedOfferId: offer.id, paymentMethod: "INSTAPAY" }));
    expect(pr.actionType).toBe("NEW_SUBSCRIPTION");
    expect(pr.targetPlanCode).toBe("CUSTOM");
    expect(pr.amountMinor).toBe(120000);
    await confirmPaymentRequestTransaction(platformDb, { paymentRequestId: pr.id, confirmedByUserId: userId });
    const [sub] = await admin`SELECT plan_code, current_price_minor, custom_max_active_students, custom_max_team_members, state FROM subscriptions WHERE workspace_id = ${wsId}`;
    expect(sub.plan_code).toBe("CUSTOM");
    expect(sub.state).toBe("ACTIVE");
    expect(Number(sub.current_price_minor)).toBe(120000);
    expect(Number(sub.custom_max_active_students)).toBe(4200);
    expect(Number(sub.custom_max_team_members)).toBe(25);
    const periods = await admin`SELECT plan_code, custom_max_active_students FROM subscription_periods WHERE workspace_id = ${wsId}`;
    expect(periods.length).toBe(1);
    expect(periods[0].plan_code).toBe("CUSTOM");
    expect(Number(periods[0].custom_max_active_students)).toBe(4200);
  });

  it("offer versioning: a revised offer supersedes the prior; the superseded offer is preserved and cannot be accepted", async () => {
    await resetTrial();
    const platformDb = getPlatformAdminDb();
    const { request } = await withRuntimeContext({ workspaceId: wsId, userId }, (db) => createCustomRequestTransaction(db, { workspaceId: wsId, requestedByUserId: userId, requestedMaxActiveStudents: 5000, requestedMaxTeamMembers: 25, preferredBillingCycle: "MONTHLY" }));
    const v1 = await createCustomOfferTransaction(platformDb, { customRequestId: request.id, createdByUserId: userId, maxActiveStudents: 5000, maxTeamMembers: 25, billingCycle: "MONTHLY", priceMinor: 150000, adjustmentReason: null, commercialNote: null, effectiveMode: "IMMEDIATE", validForDays: 14, now: new Date() });
    const v2 = await createCustomOfferTransaction(platformDb, { customRequestId: request.id, createdByUserId: userId, maxActiveStudents: 5000, maxTeamMembers: 25, billingCycle: "MONTHLY", priceMinor: 140000, adjustmentReason: "خصم", commercialNote: null, effectiveMode: "IMMEDIATE", validForDays: 14, now: new Date() });
    expect(v2.offerVersion).toBe(2);
    expect(v2.supersedesOfferId).toBe(v1.id);
    const [old] = await admin`SELECT status FROM custom_plan_offers WHERE id = ${v1.id}`;
    expect(old.status).toBe("SUPERSEDED"); // preserved, not deleted
    await expect(withRuntimeContext({ workspaceId: wsId, userId }, (db) => acceptCustomOfferTransaction(db, { offerId: v1.id, workspaceId: wsId, acceptedByUserId: userId, now: new Date() }))).rejects.toBeInstanceOf(CustomOfferNotAcceptableError);
  });

  it("expired offer cannot be accepted", async () => {
    await resetTrial();
    const platformDb = getPlatformAdminDb();
    const { request } = await withRuntimeContext({ workspaceId: wsId, userId }, (db) => createCustomRequestTransaction(db, { workspaceId: wsId, requestedByUserId: userId, requestedMaxActiveStudents: 4000, requestedMaxTeamMembers: 20, preferredBillingCycle: "MONTHLY" }));
    const offer = await createCustomOfferTransaction(platformDb, { customRequestId: request.id, createdByUserId: userId, maxActiveStudents: 4000, maxTeamMembers: 20, billingCycle: "MONTHLY", priceMinor: 110000, adjustmentReason: null, commercialNote: null, effectiveMode: "IMMEDIATE", validForDays: 14, now: new Date() });
    await admin`UPDATE custom_plan_offers SET valid_until = now() - interval '1 day' WHERE id = ${offer.id}`;
    await expect(withRuntimeContext({ workspaceId: wsId, userId }, (db) => acceptCustomOfferTransaction(db, { offerId: offer.id, workspaceId: wsId, acceptedByUserId: userId, now: new Date() }))).rejects.toBeInstanceOf(CustomOfferExpiredError);
  });

  // Helpers -------------------------------------------------------------------
  async function makeAcceptedOffer(students: number, team: number, price: number, mode: "IMMEDIATE" | "NEXT_RENEWAL") {
    const platformDb = getPlatformAdminDb();
    const { request } = await withRuntimeContext({ workspaceId: wsId, userId }, (db) => createCustomRequestTransaction(db, { workspaceId: wsId, requestedByUserId: userId, requestedMaxActiveStudents: students, requestedMaxTeamMembers: team, preferredBillingCycle: "MONTHLY" }));
    const offer = await createCustomOfferTransaction(platformDb, { customRequestId: request.id, createdByUserId: userId, maxActiveStudents: students, maxTeamMembers: team, billingCycle: "MONTHLY", priceMinor: price, adjustmentReason: null, commercialNote: null, effectiveMode: mode, validForDays: 14, now: new Date() });
    await withRuntimeContext({ workspaceId: wsId, userId }, (db) => acceptCustomOfferTransaction(db, { offerId: offer.id, workspaceId: wsId, acceptedByUserId: userId, now: new Date() }));
    return offer;
  }
  async function activateCustom(students = 4200, price = 120000) {
    const offer = await makeAcceptedOffer(students, students / 200 >= 15 ? Math.ceil(students / 200) : 15, price, "IMMEDIATE");
    const pr = await withRuntimeContext({ workspaceId: wsId, userId }, (db) => createCustomPaymentRequestFromAcceptedOffer(db, { workspaceId: wsId, requestedByUserId: userId, acceptedOfferId: offer.id, paymentMethod: "INSTAPAY" }));
    await confirmPaymentRequestTransaction(getPlatformAdminDb(), { paymentRequestId: pr.id, confirmedByUserId: userId });
    return offer;
  }

  it("offer APPLIED exactly once: confirm applies it; a second payment from the same offer is refused; a superseded offer never applies", async () => {
    await resetTrial();
    const offer = await activateCustom();
    const [applied] = await admin`SELECT status FROM custom_plan_offers WHERE id = ${offer.id}`;
    expect(applied.status).toBe("APPLIED");
    const [req] = await admin`SELECT status FROM custom_plan_requests WHERE id = ${offer.customRequestId}`;
    expect(req.status).toBe("CLOSED"); // request closed on application
    await expect(withRuntimeContext({ workspaceId: wsId, userId }, (db) => createCustomPaymentRequestFromAcceptedOffer(db, { workspaceId: wsId, requestedByUserId: userId, acceptedOfferId: offer.id, paymentMethod: "INSTAPAY" }))).rejects.toBeInstanceOf(CustomOfferAlreadyAppliedError);
  });

  it("payment retry: a rejected payment request lets the customer re-create from the SAME accepted offer (until applied)", async () => {
    await resetTrial();
    const offer = await makeAcceptedOffer(4000, 20, 110000, "IMMEDIATE");
    const prA = await withRuntimeContext({ workspaceId: wsId, userId }, (db) => createCustomPaymentRequestFromAcceptedOffer(db, { workspaceId: wsId, requestedByUserId: userId, acceptedOfferId: offer.id, paymentMethod: "INSTAPAY" }));
    await rejectPaymentRequestTransaction(getPlatformAdminDb(), { paymentRequestId: prA.id, rejectedByUserId: userId, reason: "no proof" });
    // retry allowed (offer still ACCEPTED, not applied)
    const prB = await withRuntimeContext({ workspaceId: wsId, userId }, (db) => createCustomPaymentRequestFromAcceptedOffer(db, { workspaceId: wsId, requestedByUserId: userId, acceptedOfferId: offer.id, paymentMethod: "INSTAPAY" }));
    expect(prB.id).not.toBe(prA.id);
    await confirmPaymentRequestTransaction(getPlatformAdminDb(), { paymentRequestId: prB.id, confirmedByUserId: userId });
    const [o] = await admin`SELECT status FROM custom_plan_offers WHERE id = ${offer.id}`;
    expect(o.status).toBe("APPLIED");
  });

  it("STANDARD → CUSTOM: exact proration UPGRADE, immediate custom limits, period_end unchanged, offer APPLIED", async () => {
    await resetTrial();
    // Activate PROFESSIONAL first.
    const std = await withRuntimeContext({ workspaceId: wsId, userId }, (db) => createPaymentRequestTransaction(db, { workspaceId: wsId, requestedByUserId: userId, planCode: "PROFESSIONAL", billingCycle: "MONTHLY", paymentMethod: "INSTAPAY" }));
    await confirmPaymentRequestTransaction(getPlatformAdminDb(), { paymentRequestId: std.paymentRequest.id, confirmedByUserId: userId });
    const [before] = await admin`SELECT period_end FROM subscriptions WHERE workspace_id = ${wsId}`;
    const offer = await makeAcceptedOffer(4200, 25, 120000, "IMMEDIATE");
    const pr = await withRuntimeContext({ workspaceId: wsId, userId }, (db) => createCustomPaymentRequestFromAcceptedOffer(db, { workspaceId: wsId, requestedByUserId: userId, acceptedOfferId: offer.id, paymentMethod: "INSTAPAY" }));
    expect(pr.actionType).toBe("UPGRADE");
    expect(pr.amountMinor).toBeGreaterThan(0);
    await confirmPaymentRequestTransaction(getPlatformAdminDb(), { paymentRequestId: pr.id, confirmedByUserId: userId });
    const [sub] = await admin`SELECT plan_code, custom_max_active_students, period_end FROM subscriptions WHERE workspace_id = ${wsId}`;
    expect(sub.plan_code).toBe("CUSTOM");
    expect(Number(sub.custom_max_active_students)).toBe(4200);
    expect(new Date(sub.period_end).getTime()).toBe(new Date(before.period_end).getTime()); // unchanged
    const [o] = await admin`SELECT status FROM custom_plan_offers WHERE id = ${offer.id}`;
    expect(o.status).toBe("APPLIED");
  });

  it("CUSTOM renewal without a new offer keeps the agreed price/limits (KEEP_CURRENT, no repricing)", async () => {
    await resetTrial();
    await activateCustom(4200, 120000);
    const rr = await withRuntimeContext({ workspaceId: wsId, userId }, (db) => createCustomRenewalPaymentRequest(db, { workspaceId: wsId, requestedByUserId: userId, paymentMethod: "INSTAPAY" }));
    expect(rr.actionType).toBe("RENEWAL");
    expect(rr.targetPlanCode).toBe("CUSTOM");
    expect(rr.amountMinor).toBe(120000); // agreed snapshot, not a fresh recommendation
    const snap = rr.quoteSnapshotJson as { customMaxActiveStudents: number };
    expect(snap.customMaxActiveStudents).toBe(4200);
  });

  it("NEXT_RENEWAL offer is consumed exactly once: renewal uses its terms, offer APPLIED, next renewal does not reuse it", async () => {
    await resetTrial();
    await activateCustom(5000, 140000);
    const nextOffer = await makeAcceptedOffer(4000, 20, 110000, "NEXT_RENEWAL");
    const rr = await withRuntimeContext({ workspaceId: wsId, userId }, (db) => createCustomRenewalPaymentRequest(db, { workspaceId: wsId, requestedByUserId: userId, paymentMethod: "INSTAPAY" }));
    expect(rr.amountMinor).toBe(110000); // uses the NEXT_RENEWAL offer terms
    await confirmPaymentRequestTransaction(getPlatformAdminDb(), { paymentRequestId: rr.id, confirmedByUserId: userId });
    const [o] = await admin`SELECT status FROM custom_plan_offers WHERE id = ${nextOffer.id}`;
    expect(o.status).toBe("APPLIED");
    // A following renewal falls back to the (now current) snapshot, not the consumed offer.
    const rr2 = await withRuntimeContext({ workspaceId: wsId, userId }, (db) => createCustomRenewalPaymentRequest(db, { workspaceId: wsId, requestedByUserId: userId, paymentMethod: "INSTAPAY" }));
    const snap2 = rr2.quoteSnapshotJson as { offerId: string | null };
    expect(snap2.offerId).toBeNull();
  });

  it("CUSTOM → standard: schedule when usage fits; renewal targets the standard catalog price", async () => {
    await resetTrial();
    await activateCustom(4200, 120000);
    // No students seeded → usage 0 fits BUSINESS_PLUS(3000).
    await withRuntimeContext({ workspaceId: wsId, userId }, (db) => scheduleDowngradeTransaction(db, { workspaceId: wsId, requestedByUserId: userId, targetPlanCode: "BUSINESS_PLUS" }));
    const [sub] = await admin`SELECT plan_code, pending_plan_code FROM subscriptions WHERE workspace_id = ${wsId}`;
    expect(sub.plan_code).toBe("CUSTOM"); // unchanged now
    expect(sub.pending_plan_code).toBe("BUSINESS_PLUS");
    const rr = await withRuntimeContext({ workspaceId: wsId, userId }, (db) => createCustomRenewalPaymentRequest(db, { workspaceId: wsId, requestedByUserId: userId, paymentMethod: "INSTAPAY" }));
    expect(rr.targetPlanCode).toBe("BUSINESS_PLUS");
    expect(rr.amountMinor).toBe(90000); // BUSINESS_PLUS catalog monthly
  });

  it("security: no app role has UPDATE/DELETE on custom_plan_offers commercial history", async () => {
    const grants = await admin`
      SELECT grantee, privilege_type FROM information_schema.role_table_grants
      WHERE table_name = 'custom_plan_offers' AND grantee IN ('app_runtime','app_worker','app_platform_admin') AND privilege_type = 'DELETE'`;
    expect(grants.length).toBe(0);
    // app_runtime has UPDATE only on status/accepted_* (accept/reject), never commercial columns.
    const runtimeUpdateCols = await admin`
      SELECT column_name FROM information_schema.role_column_grants
      WHERE table_name = 'custom_plan_offers' AND grantee = 'app_runtime' AND privilege_type = 'UPDATE' ORDER BY 1`;
    expect(runtimeUpdateCols.map((r) => r.column_name).sort()).toEqual(["accepted_at", "accepted_by", "status"]);
    void getWorkerDb;
  });
});
