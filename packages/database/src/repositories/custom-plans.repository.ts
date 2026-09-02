/**
 * Custom Plans repository — Billing Engine, Phase 5. Request (customer lead) +
 * Offer (platform-authored, VERSIONED, immutable commercial facts) lifecycle.
 * All commercial mutations are transaction-safe. Commercial facts are never
 * UPDATEd — a revised price is a new offer version that SUPERSEDES the prior.
 * No DELETE. Errors carry `isBillingDomainError` so the API filter maps them to
 * their 4xx code (never a 500), matching the Phase-3/4 convention.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { recommendCustom, validateCustomOffer, type BillingCycle, type CustomOfferEffectiveMode } from "@academic-precision/contracts";
import type { Db } from "./identity.repository";
import { customPlanRequests, customPlanOffers } from "../schema/custom-plans";
import { workspaces } from "../schema/workspaces";
import { users } from "../schema/identity";
import { auditEvents } from "../schema/audit";
import { outboxEvents } from "../schema/outbox";

export type CustomPlanRequestRow = typeof customPlanRequests.$inferSelect;
export type CustomPlanOfferRow = typeof customPlanOffers.$inferSelect;

// ---------------------------------------------------------------------------
// Typed domain errors (isBillingDomainError marker → 4xx via the API filter).
// ---------------------------------------------------------------------------
abstract class CustomDomainError extends Error {
  readonly isBillingDomainError = true as const;
  abstract readonly code: string;
  abstract readonly httpStatus: number;
  readonly details?: Record<string, unknown>;
}
export class CustomRequestNotEligibleError extends CustomDomainError { readonly code = "CUSTOM_REQUEST_NOT_ELIGIBLE"; readonly httpStatus = 409; constructor() { super("الباقة المخصصة تبدأ من أكثر من 3000 طالب."); this.name = "CustomRequestNotEligibleError"; } }
export class CustomOfferNotFoundError extends CustomDomainError { readonly code = "CUSTOM_OFFER_NOT_FOUND"; readonly httpStatus = 404; constructor() { super("العرض غير موجود."); this.name = "CustomOfferNotFoundError"; } }
export class CustomRequestNotFoundError extends CustomDomainError { readonly code = "CUSTOM_OFFER_NOT_FOUND"; readonly httpStatus = 404; constructor() { super("طلب الباقة المخصصة غير موجود."); this.name = "CustomRequestNotFoundError"; } }
export class CustomOfferExpiredError extends CustomDomainError { readonly code = "CUSTOM_OFFER_EXPIRED"; readonly httpStatus = 409; constructor() { super("انتهت صلاحية العرض. اطلب عرضًا محدّثًا."); this.name = "CustomOfferExpiredError"; } }
export class CustomOfferNotAcceptableError extends CustomDomainError { readonly code = "CUSTOM_OFFER_NOT_ACCEPTABLE"; readonly httpStatus = 409; constructor() { super("لم يعد العرض قابلًا للقبول."); this.name = "CustomOfferNotAcceptableError"; } }
export class CustomOfferPriceReasonRequiredError extends CustomDomainError { readonly code = "CUSTOM_OFFER_PRICE_REASON_REQUIRED"; readonly httpStatus = 400; constructor() { super("سبب تعديل السعر مطلوب عند اختلافه عن التوصية."); this.name = "CustomOfferPriceReasonRequiredError"; } }
export class CustomOfferLimitInvalidError extends CustomDomainError { readonly code = "CUSTOM_OFFER_LIMIT_INVALID"; readonly httpStatus = 400; constructor() { super("حدود الباقة المخصصة غير صالحة."); this.name = "CustomOfferLimitInvalidError"; } }
export class NoPendingCustomRequestError extends CustomDomainError { readonly code = "CUSTOM_REQUEST_NOT_FOUND"; readonly httpStatus = 409; constructor() { super("لا يوجد طلب باقة مخصصة قيد المراجعة."); this.name = "NoPendingCustomRequestError"; } }
export class CustomOfferAlreadyAppliedError extends CustomDomainError { readonly code = "CUSTOM_OFFER_ALREADY_APPLIED"; readonly httpStatus = 409; constructor() { super("تم تنفيذ هذا العرض بالفعل — لا يمكن استخدامه مرة أخرى."); this.name = "CustomOfferAlreadyAppliedError"; } }

// ---------------------------------------------------------------------------
// Customer request (owner, app_runtime).
// ---------------------------------------------------------------------------
export interface CreateCustomRequestInput {
  workspaceId: string;
  requestedByUserId: string;
  requestedMaxActiveStudents: number;
  requestedMaxTeamMembers: number;
  preferredBillingCycle: BillingCycle;
  customerNote?: string;
}

/** Owner creates a custom-plan lead. Deterministic dedup: an existing PENDING_REVIEW is REUSED (never a spam row). Recommendation is server-computed. */
export async function createCustomRequestTransaction(db: Db, input: CreateCustomRequestInput): Promise<{ request: CustomPlanRequestRow; reused: boolean }> {
  return db.transaction(async (tx) => {
    const rec = recommendCustom({ requestedMaxActiveStudents: input.requestedMaxActiveStudents, requestedMaxTeamMembers: input.requestedMaxTeamMembers, billingCycle: input.preferredBillingCycle });
    if (!rec.eligible) throw new CustomRequestNotEligibleError();

    const [existing] = await tx.select().from(customPlanRequests).where(and(eq(customPlanRequests.workspaceId, input.workspaceId), eq(customPlanRequests.status, "PENDING_REVIEW"))).limit(1);
    if (existing) return { request: existing, reused: true };

    const [row] = await tx
      .insert(customPlanRequests)
      .values({
        workspaceId: input.workspaceId,
        requestedByUserId: input.requestedByUserId,
        requestedMaxActiveStudents: input.requestedMaxActiveStudents,
        requestedMaxTeamMembers: input.requestedMaxTeamMembers,
        preferredBillingCycle: input.preferredBillingCycle,
        customerNote: input.customerNote ?? null,
        recommendedPriceMinor: rec.recommendedPriceMinor,
        recommendedMaxTeamMembers: rec.recommendedMaxTeamMembers,
        recommendationVersion: rec.recommendationVersion,
        status: "PENDING_REVIEW",
      })
      .returning();
    if (!row) throw new Error("Failed to insert custom_plan_requests row.");

    await tx.insert(auditEvents).values({ workspaceId: input.workspaceId, actorUserId: input.requestedByUserId, actorMembershipId: null, action: "billing.custom_request.created", entityType: "custom_plan_request", entityId: row.id, afterJson: { requestedMaxActiveStudents: input.requestedMaxActiveStudents, requestedMaxTeamMembers: input.requestedMaxTeamMembers, billingCycle: input.preferredBillingCycle } });
    await tx.insert(outboxEvents).values({ workspaceId: input.workspaceId, eventType: "CustomRequestCreated", aggregateType: "CustomPlanRequest", aggregateId: row.id, payload: { requestId: row.id } });
    return { request: row, reused: false };
  });
}

export async function cancelCustomRequestTransaction(db: Db, input: { workspaceId: string; actorUserId: string }): Promise<CustomPlanRequestRow> {
  return db.transaction(async (tx) => {
    const [req] = await tx.select().from(customPlanRequests).where(and(eq(customPlanRequests.workspaceId, input.workspaceId), eq(customPlanRequests.status, "PENDING_REVIEW"))).limit(1);
    if (!req) throw new NoPendingCustomRequestError();
    const [row] = await tx.update(customPlanRequests).set({ status: "CANCELLED", updatedAt: new Date(), version: req.version + 1 }).where(eq(customPlanRequests.id, req.id)).returning();
    if (!row) throw new Error("Failed to cancel custom_plan_requests row.");
    await tx.insert(auditEvents).values({ workspaceId: input.workspaceId, actorUserId: input.actorUserId, actorMembershipId: null, action: "billing.custom_request.cancelled", entityType: "custom_plan_request", entityId: req.id, beforeJson: { status: "PENDING_REVIEW" }, afterJson: { status: "CANCELLED" } });
    return row;
  });
}

export function getLatestCustomRequestForWorkspace(db: Db, workspaceId: string): Promise<CustomPlanRequestRow | undefined> {
  return db.select().from(customPlanRequests).where(eq(customPlanRequests.workspaceId, workspaceId)).orderBy(desc(customPlanRequests.createdAt)).limit(1).then((r) => r[0]);
}

// ---------------------------------------------------------------------------
// Platform offer (app_platform_admin). Immutable/versioned commercial facts.
// ---------------------------------------------------------------------------
export interface CreateCustomOfferInput {
  customRequestId: string;
  createdByUserId: string;
  maxActiveStudents: number;
  maxTeamMembers: number;
  billingCycle: BillingCycle;
  priceMinor: number;
  adjustmentReason?: string | null;
  commercialNote?: string | null;
  effectiveMode: CustomOfferEffectiveMode;
  validForDays: number;
  now: Date;
}

/** Platform admin authors an offer (or a revised version). Recomputes the recommendation for the offered capacity, validates the authorized price (reason mandatory on any difference), supersedes a prior PENDING_CUSTOMER offer, and marks the request OFFERED. */
export async function createCustomOfferTransaction(db: Db, input: CreateCustomOfferInput): Promise<CustomPlanOfferRow> {
  return db.transaction(async (tx) => {
    const [req] = await tx.select().from(customPlanRequests).where(eq(customPlanRequests.id, input.customRequestId)).for("update");
    if (!req) throw new CustomRequestNotFoundError();

    const rec = recommendCustom({ requestedMaxActiveStudents: input.maxActiveStudents, requestedMaxTeamMembers: input.maxTeamMembers, billingCycle: input.billingCycle });
    let priceDifferenceMinor: number;
    try {
      ({ priceDifferenceMinor } = validateCustomOffer({ maxActiveStudents: input.maxActiveStudents, maxTeamMembers: input.maxTeamMembers, billingCycle: input.billingCycle, priceMinor: input.priceMinor, recommendationPriceMinor: rec.recommendedPriceMinor, adjustmentReason: input.adjustmentReason ?? null }));
    } catch (e) {
      const reason = (e as { reason?: string }).reason;
      if (reason === "CUSTOM_OFFER_PRICE_REASON_REQUIRED") throw new CustomOfferPriceReasonRequiredError();
      throw new CustomOfferLimitInvalidError();
    }

    // Supersede any LIVE offer for this request (PENDING_CUSTOMER or an accepted-
    // but-not-yet-applied ACCEPTED) — a revision replaces prior terms, keeping at
    // most one authoritative live offer. An APPLIED offer is never superseded
    // (its terms are already committed to the subscription/ledger).
    const priors = await tx.select().from(customPlanOffers).where(and(eq(customPlanOffers.customRequestId, req.id), inArray(customPlanOffers.status, ["PENDING_CUSTOMER", "ACCEPTED"])));
    let supersededPending: string | null = null;
    for (const prior of priors) {
      await tx.update(customPlanOffers).set({ status: "SUPERSEDED" }).where(eq(customPlanOffers.id, prior.id));
      await tx.insert(auditEvents).values({ workspaceId: req.workspaceId, actorUserId: input.createdByUserId, actorMembershipId: null, action: "billing.custom_offer.superseded", entityType: "custom_plan_offer", entityId: prior.id, afterJson: { status: "SUPERSEDED", from: prior.status } });
      if (prior.status === "PENDING_CUSTOMER") supersededPending = prior.id;
    }

    const versions = await tx.select({ v: customPlanOffers.offerVersion }).from(customPlanOffers).where(eq(customPlanOffers.customRequestId, req.id)).orderBy(desc(customPlanOffers.offerVersion)).limit(1);
    const nextVersion = (versions[0]?.v ?? 0) + 1;

    const [offer] = await tx
      .insert(customPlanOffers)
      .values({
        customRequestId: req.id,
        workspaceId: req.workspaceId,
        offerVersion: nextVersion,
        maxActiveStudents: input.maxActiveStudents,
        maxTeamMembers: input.maxTeamMembers,
        billingCycle: input.billingCycle,
        priceMinor: input.priceMinor,
        recommendationPriceMinor: rec.recommendedPriceMinor,
        priceDifferenceMinor,
        adjustmentReason: input.adjustmentReason ?? null,
        commercialNote: input.commercialNote ?? null,
        effectiveMode: input.effectiveMode,
        validUntil: new Date(input.now.getTime() + input.validForDays * 24 * 60 * 60 * 1000),
        status: "PENDING_CUSTOMER",
        createdByUserId: input.createdByUserId,
        supersedesOfferId: supersededPending,
      })
      .returning();
    if (!offer) throw new Error("Failed to insert custom_plan_offers row.");

    if (req.status !== "OFFERED") await tx.update(customPlanRequests).set({ status: "OFFERED", updatedAt: new Date(), version: req.version + 1 }).where(eq(customPlanRequests.id, req.id));

    await tx.insert(auditEvents).values({ workspaceId: req.workspaceId, actorUserId: input.createdByUserId, actorMembershipId: null, action: "billing.custom_offer.created", entityType: "custom_plan_offer", entityId: offer.id, afterJson: { offerVersion: nextVersion, maxActiveStudents: input.maxActiveStudents, maxTeamMembers: input.maxTeamMembers, priceMinor: input.priceMinor, recommendationPriceMinor: rec.recommendedPriceMinor, priceDifferenceMinor, adjustmentReason: input.adjustmentReason ?? null, effectiveMode: input.effectiveMode } });
    await tx.insert(outboxEvents).values({ workspaceId: req.workspaceId, eventType: "CustomOfferCreated", aggregateType: "CustomPlanOffer", aggregateId: offer.id, payload: { offerId: offer.id, offerVersion: nextVersion } });
    return offer;
  });
}

// ---------------------------------------------------------------------------
// Customer accept / reject (owner, app_runtime).
// ---------------------------------------------------------------------------
export async function acceptCustomOfferTransaction(db: Db, input: { offerId: string; workspaceId: string; acceptedByUserId: string; now: Date }): Promise<CustomPlanOfferRow> {
  return db.transaction(async (tx) => {
    const [offer] = await tx.select().from(customPlanOffers).where(eq(customPlanOffers.id, input.offerId)).for("update");
    if (!offer || offer.workspaceId !== input.workspaceId) throw new CustomOfferNotFoundError();
    if (offer.status === "ACCEPTED") return offer; // idempotent
    if (offer.status !== "PENDING_CUSTOMER") throw new CustomOfferNotAcceptableError();
    if (offer.validUntil.getTime() < input.now.getTime()) throw new CustomOfferExpiredError();
    const [row] = await tx.update(customPlanOffers).set({ status: "ACCEPTED", acceptedAt: input.now, acceptedByUserId: input.acceptedByUserId }).where(eq(customPlanOffers.id, offer.id)).returning();
    if (!row) throw new Error("Failed to accept custom_plan_offers row.");
    await tx.insert(auditEvents).values({ workspaceId: offer.workspaceId, actorUserId: input.acceptedByUserId, actorMembershipId: null, action: "billing.custom_offer.accepted", entityType: "custom_plan_offer", entityId: offer.id, afterJson: { status: "ACCEPTED", offerVersion: offer.offerVersion } });
    await tx.insert(outboxEvents).values({ workspaceId: offer.workspaceId, eventType: "CustomOfferAccepted", aggregateType: "CustomPlanOffer", aggregateId: offer.id, payload: { offerId: offer.id } });
    return row;
  });
}

export async function rejectCustomOfferTransaction(db: Db, input: { offerId: string; workspaceId: string; actorUserId: string }): Promise<CustomPlanOfferRow> {
  return db.transaction(async (tx) => {
    const [offer] = await tx.select().from(customPlanOffers).where(eq(customPlanOffers.id, input.offerId)).for("update");
    if (!offer || offer.workspaceId !== input.workspaceId) throw new CustomOfferNotFoundError();
    if (offer.status === "REJECTED") return offer; // idempotent
    if (offer.status !== "PENDING_CUSTOMER") throw new CustomOfferNotAcceptableError();
    const [row] = await tx.update(customPlanOffers).set({ status: "REJECTED" }).where(eq(customPlanOffers.id, offer.id)).returning();
    if (!row) throw new Error("Failed to reject custom_plan_offers row.");
    await tx.insert(auditEvents).values({ workspaceId: offer.workspaceId, actorUserId: input.actorUserId, actorMembershipId: null, action: "billing.custom_offer.rejected", entityType: "custom_plan_offer", entityId: offer.id, afterJson: { status: "REJECTED" } });
    return row;
  });
}

// ---------------------------------------------------------------------------
// Reads.
// ---------------------------------------------------------------------------
export function findCustomOfferById(db: Db, offerId: string): Promise<CustomPlanOfferRow | undefined> {
  return db.select().from(customPlanOffers).where(eq(customPlanOffers.id, offerId)).limit(1).then((r) => r[0]);
}

/** The offer the customer should currently see: the live PENDING_CUSTOMER, else the most recent ACCEPTED, for a workspace. */
export function getCustomerVisibleOffer(db: Db, workspaceId: string): Promise<CustomPlanOfferRow | undefined> {
  return db
    .select()
    .from(customPlanOffers)
    .where(eq(customPlanOffers.workspaceId, workspaceId))
    .orderBy(desc(customPlanOffers.createdAt))
    .limit(1)
    .then((r) => r[0]);
}

/** The offer row by id + workspace (any status) — the payment path branches on status for a precise error. */
export async function findCustomOfferForWorkspace(db: Db, workspaceId: string, offerId: string): Promise<CustomPlanOfferRow | undefined> {
  const [offer] = await db.select().from(customPlanOffers).where(and(eq(customPlanOffers.id, offerId), eq(customPlanOffers.workspaceId, workspaceId))).limit(1);
  return offer;
}

/** Authoritative accepted offer — ONLY status ACCEPTED (never APPLIED/SUPERSEDED/EXPIRED/REJECTED/CANCELLED). */
export async function findAcceptedAuthoritativeOffer(db: Db, workspaceId: string, offerId: string): Promise<CustomPlanOfferRow | undefined> {
  const [offer] = await db.select().from(customPlanOffers).where(and(eq(customPlanOffers.id, offerId), eq(customPlanOffers.workspaceId, workspaceId), eq(customPlanOffers.status, "ACCEPTED"))).limit(1);
  return offer;
}

/**
 * Consume an accepted offer: ACCEPTED → APPLIED, and CLOSE its request. Called
 * INSIDE the confirm transaction so activation and application are atomic — any
 * rollback leaves the offer ACCEPTED (retryable). Idempotent guard: only an
 * ACCEPTED row transitions (a concurrent/duplicate confirm sees APPLIED and
 * makes no second change).
 */
export async function markOfferAppliedOnTx(tx: Db, offerId: string, actorUserId: string | null): Promise<void> {
  const [applied] = await tx.update(customPlanOffers).set({ status: "APPLIED" }).where(and(eq(customPlanOffers.id, offerId), eq(customPlanOffers.status, "ACCEPTED"))).returning();
  if (!applied) return; // already APPLIED (idempotent) or not ACCEPTED
  await tx.update(customPlanRequests).set({ status: "CLOSED", updatedAt: new Date() }).where(and(eq(customPlanRequests.id, applied.customRequestId), inArray(customPlanRequests.status, ["PENDING_REVIEW", "OFFERED"])));
  await tx.insert(auditEvents).values({ workspaceId: applied.workspaceId, actorUserId, actorMembershipId: null, action: "billing.custom_offer.applied", entityType: "custom_plan_offer", entityId: applied.id, afterJson: { status: "APPLIED", offerVersion: applied.offerVersion } });
}

export function listOffersForRequest(db: Db, customRequestId: string): Promise<CustomPlanOfferRow[]> {
  return db.select().from(customPlanOffers).where(eq(customPlanOffers.customRequestId, customRequestId)).orderBy(asc(customPlanOffers.offerVersion));
}

export interface PlatformCustomRequestListRow extends CustomPlanRequestRow {
  workspaceName: string | null;
  customerName: string | null;
}

/** Platform admin: open custom requests with customer context. */
export function listPlatformCustomRequests(db: Db, status?: string): Promise<PlatformCustomRequestListRow[]> {
  return db
    .select({ request: customPlanRequests, workspaceName: workspaces.name, customerName: users.fullName })
    .from(customPlanRequests)
    .innerJoin(workspaces, eq(workspaces.id, customPlanRequests.workspaceId))
    .leftJoin(users, eq(users.id, customPlanRequests.requestedByUserId))
    .where(status ? eq(customPlanRequests.status, status) : undefined)
    .orderBy(desc(customPlanRequests.createdAt))
    .limit(100)
    .then((rs) => rs.map((r) => ({ ...r.request, workspaceName: r.workspaceName, customerName: r.customerName })));
}
