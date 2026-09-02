import { Injectable } from "@nestjs/common";
import {
  createCustomOfferTransaction,
  getPlatformAdminDb,
  listOffersForRequest,
  listPlatformCustomRequests,
  type CustomPlanOfferRow,
  type PlatformCustomRequestListRow,
} from "@academic-precision/database";
import type {
  BillingCycle,
  CreateCustomOffer,
  ListPlatformCustomRequestsResponse,
  PlatformCustomOfferDto,
  PlatformCustomRequestDto,
} from "@academic-precision/contracts";
import { effectiveCustomOfferStatus } from "@academic-precision/contracts";

/**
 * Platform-admin Custom Plans (Phase 5). Runs on app_platform_admin. The
 * recommendation is visible ONLY here (never to the customer). Permissions
 * (platform.billing.view / .manage) enforced by the controller guards —
 * SUPPORT_AGENT has neither .manage, so it can never author an offer.
 */
@Injectable()
export class PlatformCustomService {
  async listRequests(status?: string): Promise<ListPlatformCustomRequestsResponse> {
    const rows = await listPlatformCustomRequests(getPlatformAdminDb(), status);
    return { items: rows.map(toPlatformRequestDto) };
  }

  async listOffers(requestId: string): Promise<{ offers: PlatformCustomOfferDto[] }> {
    const rows = await listOffersForRequest(getPlatformAdminDb(), requestId);
    return { offers: rows.map(toPlatformOfferDto) };
  }

  async createOffer(createdByUserId: string, body: CreateCustomOffer): Promise<{ offer: PlatformCustomOfferDto }> {
    const offer = await createCustomOfferTransaction(getPlatformAdminDb(), {
      customRequestId: body.customRequestId,
      createdByUserId,
      maxActiveStudents: body.maxActiveStudents,
      maxTeamMembers: body.maxTeamMembers,
      billingCycle: body.billingCycle as BillingCycle,
      priceMinor: body.priceMinor,
      adjustmentReason: body.adjustmentReason ?? null,
      commercialNote: body.commercialNote ?? null,
      effectiveMode: body.effectiveMode,
      validForDays: body.validForDays,
      now: new Date(),
    });
    return { offer: toPlatformOfferDto(offer) };
  }
}

function toPlatformRequestDto(r: PlatformCustomRequestListRow): PlatformCustomRequestDto {
  return {
    id: r.id,
    requestedMaxActiveStudents: r.requestedMaxActiveStudents,
    requestedMaxTeamMembers: r.requestedMaxTeamMembers,
    preferredBillingCycle: r.preferredBillingCycle as BillingCycle,
    status: r.status as PlatformCustomRequestDto["status"],
    createdAt: r.createdAt.toISOString(),
    workspaceId: r.workspaceId,
    workspaceName: r.workspaceName,
    customerName: r.customerName,
    customerNote: r.customerNote,
    recommendedPriceMinor: r.recommendedPriceMinor,
    recommendedMaxTeamMembers: r.recommendedMaxTeamMembers,
    recommendationVersion: r.recommendationVersion,
  };
}

function toPlatformOfferDto(o: CustomPlanOfferRow): PlatformCustomOfferDto {
  return {
    id: o.id,
    offerVersion: o.offerVersion,
    maxActiveStudents: o.maxActiveStudents,
    maxTeamMembers: o.maxTeamMembers,
    billingCycle: o.billingCycle as BillingCycle,
    priceMinor: o.priceMinor,
    currencyCode: o.currencyCode,
    // Derive-on-read: a PENDING_CUSTOMER offer past valid_until shows as EXPIRED even before the worker flip.
    status: effectiveCustomOfferStatus({ status: o.status, validUntilMs: o.validUntil.getTime(), nowMs: Date.now() }) as PlatformCustomOfferDto["status"],
    effectiveMode: o.effectiveMode as PlatformCustomOfferDto["effectiveMode"],
    validUntil: o.validUntil.toISOString(),
    createdAt: o.createdAt.toISOString(),
    workspaceId: o.workspaceId,
    customRequestId: o.customRequestId,
    recommendationPriceMinor: o.recommendationPriceMinor,
    priceDifferenceMinor: o.priceDifferenceMinor,
    adjustmentReason: o.adjustmentReason,
    commercialNote: o.commercialNote,
    supersedesOfferId: o.supersedesOfferId,
    acceptedAt: o.acceptedAt ? o.acceptedAt.toISOString() : null,
  };
}
