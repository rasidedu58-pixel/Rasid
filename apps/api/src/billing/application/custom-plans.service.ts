import { Injectable } from "@nestjs/common";
import {
  acceptCustomOfferTransaction,
  cancelCustomRequestTransaction,
  createCustomPaymentRequestFromAcceptedOffer,
  createCustomRequestTransaction,
  getCustomerVisibleOffer,
  getLatestCustomRequestForWorkspace,
  loadBillingPlanState,
  rejectCustomOfferTransaction,
  withRuntimeContext,
  type CustomPlanOfferRow,
  type CustomPlanRequestRow,
  type PaymentRequestRow,
} from "@academic-precision/database";
import { loadServerEnv } from "@academic-precision/config";
import {
  shouldSurfaceCustomCta,
  type BillingCycle,
  type BillingPaymentMethod,
  type CreateCustomPaymentRequest,
  type CreateCustomRequest,
  type CreatePaymentRequestResponse,
  type CustomOfferDto,
  type CustomRequestDto,
  type GetCustomPlanStateResponse,
  type PaymentRequestDto,
} from "@academic-precision/contracts";
import { ForbiddenApiException } from "../../common/exceptions/api.exception";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import type { WorkspaceContext } from "../../team/api/guards/permission.guard";
import { buildPaymentInstructions, type BillingChannelConfig } from "./payment-instructions";

const OWNER_ROLE_LABEL = "OWNER";

/** Customer-facing Custom Plans (Phase 5). Owner-only. Server prices everything; the client never sends amount/limits. Runs under app_runtime. */
@Injectable()
export class CustomPlansService {
  private assertOwner(ctx: WorkspaceContext): void {
    if (ctx.membership.roleLabel !== OWNER_ROLE_LABEL) throw new ForbiddenApiException();
  }
  private channelConfig(): BillingChannelConfig {
    const env = loadServerEnv();
    return { instapayHandle: env.RASID_INSTAPAY_HANDLE, vodafoneCashNumber: env.RASID_VODAFONE_CASH_NUMBER, billingWhatsappNumber: env.RASID_BILLING_WHATSAPP_NUMBER };
  }

  async createRequest(user: VerifiedSupabaseToken, ctx: WorkspaceContext, body: CreateCustomRequest): Promise<{ request: CustomRequestDto }> {
    this.assertOwner(ctx);
    const { request } = await withRuntimeContext({ userId: user.id, workspaceId: ctx.workspaceId }, (db) =>
      createCustomRequestTransaction(db, { workspaceId: ctx.workspaceId, requestedByUserId: user.id, requestedMaxActiveStudents: body.requestedMaxActiveStudents, requestedMaxTeamMembers: body.requestedMaxTeamMembers, preferredBillingCycle: body.preferredBillingCycle as BillingCycle, customerNote: body.customerNote }),
    );
    return { request: toRequestDto(request) };
  }

  async cancelRequest(user: VerifiedSupabaseToken, ctx: WorkspaceContext): Promise<{ request: CustomRequestDto }> {
    this.assertOwner(ctx);
    const request = await withRuntimeContext({ userId: user.id, workspaceId: ctx.workspaceId }, (db) => cancelCustomRequestTransaction(db, { workspaceId: ctx.workspaceId, actorUserId: user.id }));
    return { request: toRequestDto(request) };
  }

  async getState(user: VerifiedSupabaseToken, ctx: WorkspaceContext): Promise<GetCustomPlanStateResponse> {
    this.assertOwner(ctx);
    return withRuntimeContext({ userId: user.id, workspaceId: ctx.workspaceId }, async (db) => {
      const planState = await loadBillingPlanState(db, ctx.workspaceId);
      const request = await getLatestCustomRequestForWorkspace(db, ctx.workspaceId);
      const offer = await getCustomerVisibleOffer(db, ctx.workspaceId);
      const activeStudents = planState?.usage.activeStudents ?? 0;
      return {
        customState: {
          customCtaVisible: shouldSurfaceCustomCta(activeStudents),
          currentPlanCode: planState?.currentPlanCode ?? null,
          request: request && (request.status === "PENDING_REVIEW" || request.status === "OFFERED") ? toRequestDto(request) : null,
          offer: offer ? toCustomerOfferDto(offer) : null,
        },
      };
    });
  }

  async acceptOffer(user: VerifiedSupabaseToken, ctx: WorkspaceContext, offerId: string): Promise<{ offer: CustomOfferDto }> {
    this.assertOwner(ctx);
    const offer = await withRuntimeContext({ userId: user.id, workspaceId: ctx.workspaceId }, (db) => acceptCustomOfferTransaction(db, { offerId, workspaceId: ctx.workspaceId, acceptedByUserId: user.id, now: new Date() }));
    return { offer: toCustomerOfferDto(offer) };
  }

  async rejectOffer(user: VerifiedSupabaseToken, ctx: WorkspaceContext, offerId: string): Promise<{ offer: CustomOfferDto }> {
    this.assertOwner(ctx);
    const offer = await withRuntimeContext({ userId: user.id, workspaceId: ctx.workspaceId }, (db) => rejectCustomOfferTransaction(db, { offerId, workspaceId: ctx.workspaceId, actorUserId: user.id }));
    return { offer: toCustomerOfferDto(offer) };
  }

  async createPayment(user: VerifiedSupabaseToken, ctx: WorkspaceContext, body: CreateCustomPaymentRequest): Promise<CreatePaymentRequestResponse> {
    this.assertOwner(ctx);
    const paymentRequest = await withRuntimeContext({ userId: user.id, workspaceId: ctx.workspaceId }, (db) =>
      createCustomPaymentRequestFromAcceptedOffer(db, { workspaceId: ctx.workspaceId, requestedByUserId: user.id, acceptedOfferId: body.acceptedOfferId, paymentMethod: body.paymentMethod }),
    );
    const instructions = buildPaymentInstructions(this.channelConfig(), { method: paymentRequest.paymentMethod as BillingPaymentMethod, planCode: paymentRequest.targetPlanCode, billingCycle: paymentRequest.billingCycle as BillingCycle, amountMinor: paymentRequest.amountMinor, currencyCode: paymentRequest.currencyCode, humanCode: paymentRequest.humanCode });
    return { paymentRequest: toPaymentDto(paymentRequest), instructions };
  }
}

function toRequestDto(r: CustomPlanRequestRow): CustomRequestDto {
  return { id: r.id, requestedMaxActiveStudents: r.requestedMaxActiveStudents, requestedMaxTeamMembers: r.requestedMaxTeamMembers, preferredBillingCycle: r.preferredBillingCycle as BillingCycle, status: r.status as CustomRequestDto["status"], createdAt: r.createdAt.toISOString() };
}
function toCustomerOfferDto(o: CustomPlanOfferRow): CustomOfferDto {
  return { id: o.id, offerVersion: o.offerVersion, maxActiveStudents: o.maxActiveStudents, maxTeamMembers: o.maxTeamMembers, billingCycle: o.billingCycle as BillingCycle, priceMinor: o.priceMinor, currencyCode: o.currencyCode, status: o.status as CustomOfferDto["status"], effectiveMode: o.effectiveMode as CustomOfferDto["effectiveMode"], validUntil: o.validUntil.toISOString(), createdAt: o.createdAt.toISOString() };
}
function toPaymentDto(row: PaymentRequestRow): PaymentRequestDto {
  return { id: row.id, humanCode: row.humanCode, actionType: row.actionType as PaymentRequestDto["actionType"], targetPlanCode: row.targetPlanCode, billingCycle: row.billingCycle as BillingCycle, amountMinor: row.amountMinor, currencyCode: row.currencyCode, paymentMethod: row.paymentMethod as BillingPaymentMethod, status: row.status as PaymentRequestDto["status"], rejectReason: row.rejectReason, expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null, createdAt: row.createdAt.toISOString() };
}
