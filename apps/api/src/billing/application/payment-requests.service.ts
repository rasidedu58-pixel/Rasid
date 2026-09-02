import { Injectable } from "@nestjs/common";
import {
  cancelScheduledDowngradeTransaction,
  createPaymentRequestTransaction,
  listPaymentRequestsForWorkspace,
  loadBillingPlanState,
  loadBillingHistory,
  quoteUpgradeForWorkspace,
  scheduleDowngradeTransaction,
  withRuntimeContext,
  type PaymentRequestRow,
} from "@academic-precision/database";
import { loadServerEnv } from "@academic-precision/config";
import type {
  BillingCycle,
  BillingPaymentMethod,
  BillingPlanStateDto,
  CreatePaymentRequest,
  CreatePaymentRequestResponse,
  GetBillingPlanStateResponse,
  ListPaymentRequestsResponse,
  PaymentRequestDto,
  ListBillingHistoryResponse,
  ScheduleDowngradeRequest,
  ScheduleDowngradeResponse,
  StandardPlanCode,
  UpgradeQuoteRequest,
  UpgradeQuoteResponse,
} from "@academic-precision/contracts";
import { effectivePaymentRequestStatus } from "@academic-precision/contracts";
import { ForbiddenApiException, ResourceNotFoundException } from "../../common/exceptions/api.exception";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import type { WorkspaceContext } from "../../team/api/guards/permission.guard";
import { buildPaymentInstructions, type BillingChannelConfig } from "./payment-instructions";

const OWNER_ROLE_LABEL = "OWNER";

/**
 * Customer-facing payment requests (Billing Phase 3). Owner-only. Price is
 * SERVER-computed inside the DB transaction from the plan catalog — the client
 * only sends {planCode, billingCycle, paymentMethod}. Runs under app_runtime.
 */
@Injectable()
export class PaymentRequestsService {
  private channelConfig(): BillingChannelConfig {
    const env = loadServerEnv();
    return {
      instapayHandle: env.RASID_INSTAPAY_HANDLE,
      vodafoneCashNumber: env.RASID_VODAFONE_CASH_NUMBER,
      billingWhatsappNumber: env.RASID_BILLING_WHATSAPP_NUMBER,
    };
  }

  private assertOwner(workspaceContext: WorkspaceContext): void {
    if (workspaceContext.membership.roleLabel !== OWNER_ROLE_LABEL) throw new ForbiddenApiException();
  }

  async createPaymentRequest(
    user: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    body: CreatePaymentRequest,
  ): Promise<CreatePaymentRequestResponse> {
    this.assertOwner(workspaceContext);
    const { paymentRequest } = await withRuntimeContext(
      { userId: user.id, workspaceId: workspaceContext.workspaceId },
      (db) =>
        createPaymentRequestTransaction(db, {
          workspaceId: workspaceContext.workspaceId,
          requestedByUserId: user.id,
          planCode: body.planCode as StandardPlanCode,
          billingCycle: body.billingCycle as BillingCycle,
          paymentMethod: body.paymentMethod,
        }),
    );
    const instructions = buildPaymentInstructions(this.channelConfig(), {
      method: paymentRequest.paymentMethod as BillingPaymentMethod,
      planCode: paymentRequest.targetPlanCode,
      billingCycle: paymentRequest.billingCycle as BillingCycle,
      amountMinor: paymentRequest.amountMinor,
      currencyCode: paymentRequest.currencyCode,
      humanCode: paymentRequest.humanCode,
    });
    return { paymentRequest: this.toDto(paymentRequest), instructions };
  }

  async listPaymentRequests(
    user: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
  ): Promise<ListPaymentRequestsResponse> {
    this.assertOwner(workspaceContext);
    const rows = await withRuntimeContext(
      { userId: user.id, workspaceId: workspaceContext.workspaceId },
      (db) => listPaymentRequestsForWorkspace(db, workspaceContext.workspaceId),
    );
    return { paymentRequests: rows.map((r) => this.toDto(r)) };
  }

  async getBillingHistory(
    user: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    query: { cursor?: string; limit?: number },
  ): Promise<ListBillingHistoryResponse> {
    this.assertOwner(workspaceContext);
    const page = await withRuntimeContext(
      { userId: user.id, workspaceId: workspaceContext.workspaceId },
      (db) => loadBillingHistory(db, { workspaceId: workspaceContext.workspaceId, cursor: query.cursor ?? null, limit: query.limit }),
    );
    return page as ListBillingHistoryResponse;
  }

  // ── Phase 4: plan state, upgrade quote, downgrade schedule/cancel (owner-only) ──

  async getPlanState(user: VerifiedSupabaseToken, workspaceContext: WorkspaceContext): Promise<GetBillingPlanStateResponse> {
    this.assertOwner(workspaceContext);
    const planState = await withRuntimeContext(
      { userId: user.id, workspaceId: workspaceContext.workspaceId },
      (db) => loadBillingPlanState(db, workspaceContext.workspaceId),
    );
    if (!planState) throw new ResourceNotFoundException();
    return { planState: planState as BillingPlanStateDto };
  }

  async quoteUpgrade(user: VerifiedSupabaseToken, workspaceContext: WorkspaceContext, body: UpgradeQuoteRequest): Promise<UpgradeQuoteResponse> {
    this.assertOwner(workspaceContext);
    const quote = await withRuntimeContext(
      { userId: user.id, workspaceId: workspaceContext.workspaceId },
      (db) =>
        quoteUpgradeForWorkspace(db, {
          workspaceId: workspaceContext.workspaceId,
          targetPlanCode: body.targetPlanCode as StandardPlanCode,
          billingCycle: body.billingCycle as BillingCycle,
        }),
    );
    return quote as UpgradeQuoteResponse;
  }

  async scheduleDowngrade(user: VerifiedSupabaseToken, workspaceContext: WorkspaceContext, body: ScheduleDowngradeRequest): Promise<ScheduleDowngradeResponse> {
    this.assertOwner(workspaceContext);
    const sub = await withRuntimeContext(
      { userId: user.id, workspaceId: workspaceContext.workspaceId },
      (db) => scheduleDowngradeTransaction(db, { workspaceId: workspaceContext.workspaceId, requestedByUserId: user.id, targetPlanCode: body.targetPlanCode as StandardPlanCode }),
    );
    return {
      pendingDowngrade: sub.pendingPlanCode && sub.pendingBillingCycle ? { targetPlanCode: sub.pendingPlanCode, billingCycle: sub.pendingBillingCycle as BillingCycle } : null,
    };
  }

  async cancelDowngrade(user: VerifiedSupabaseToken, workspaceContext: WorkspaceContext): Promise<ScheduleDowngradeResponse> {
    this.assertOwner(workspaceContext);
    await withRuntimeContext(
      { userId: user.id, workspaceId: workspaceContext.workspaceId },
      (db) => cancelScheduledDowngradeTransaction(db, { workspaceId: workspaceContext.workspaceId, actorUserId: user.id }),
    );
    return { pendingDowngrade: null };
  }

  private toDto(row: PaymentRequestRow): PaymentRequestDto {
    return {
      id: row.id,
      humanCode: row.humanCode,
      actionType: row.actionType as PaymentRequestDto["actionType"],
      targetPlanCode: row.targetPlanCode,
      billingCycle: row.billingCycle as BillingCycle,
      amountMinor: row.amountMinor,
      currencyCode: row.currencyCode,
      paymentMethod: row.paymentMethod as BillingPaymentMethod,
      // Derive-on-read: a PENDING request past its expiry shows as EXPIRED even before the worker flip.
      status: effectivePaymentRequestStatus({ status: row.status, expiresAtMs: row.expiresAt ? row.expiresAt.getTime() : null, nowMs: Date.now() }) as PaymentRequestDto["status"],
      rejectReason: row.rejectReason,
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
