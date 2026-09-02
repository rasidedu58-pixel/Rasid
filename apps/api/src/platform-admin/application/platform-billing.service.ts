import { Injectable } from "@nestjs/common";
import {
  confirmPaymentRequestTransaction,
  findPlatformPaymentRequestById,
  getPlatformAdminDb,
  listPlatformPaymentRequests,
  loadBillingReadinessDbChecks,
  loadPlatformBillingAttention,
  loadPlatformBillingHistory,
  rejectPaymentRequestTransaction,
  type PlatformPaymentRequestListRow,
} from "@academic-precision/database";
import { loadServerEnv } from "@academic-precision/config";
import {
  computeLaunchReady,
  type BillingCycle,
  type BillingPaymentMethod,
  type LaunchReadinessItem,
  type LaunchReadinessResponse,
  type ListBillingAttentionResponse,
  type ListPlatformBillingHistoryResponse,
  type ListPlatformPaymentRequestsResponse,
  type PlatformPaymentRequestDto,
  type ResolvePaymentRequestResponse,
} from "@academic-precision/contracts";
import { ResourceNotFoundException } from "../../common/exceptions/api.exception";

/**
 * Platform-admin billing (Billing Phase 3): list payment requests + confirm /
 * reject. Runs on `app_platform_admin`. Permissions (platform.billing.view /
 * platform.billing.manage) are enforced by the controller's guards — SUPPORT_AGENT
 * has neither, so it can never confirm a payment.
 */
@Injectable()
export class PlatformBillingService {
  async listPaymentRequests(params: { status?: string; cursor?: string; limit?: number }): Promise<ListPlatformPaymentRequestsResponse> {
    const limit = Math.min(Math.max(params.limit ?? 30, 1), 100);
    const cursor = decodeCursor(params.cursor);
    const result = await listPlatformPaymentRequests(getPlatformAdminDb(), { status: params.status, cursor, limit });
    return {
      items: result.items.map(toPlatformDto),
      page: { nextCursor: result.nextCursor ? encodeCursor(result.nextCursor) : null, hasNext: result.hasNext },
    };
  }

  /** The deterministic platform triage queue (severity + age). */
  async getAttention(): Promise<ListBillingAttentionResponse> {
    const items = await loadPlatformBillingAttention(getPlatformAdminDb());
    return { items };
  }

  /** Cross-customer curated billing history (read-only; never raw audit JSON / internal notes / recommendation). */
  async getHistory(params: { workspaceId?: string; category?: string; cursor?: string; limit?: number }): Promise<ListPlatformBillingHistoryResponse> {
    const page = await loadPlatformBillingHistory(getPlatformAdminDb(), {
      workspaceId: params.workspaceId ?? null,
      category: params.category ?? null,
      cursor: params.cursor ?? null,
      limit: params.limit,
    });
    return page as ListPlatformBillingHistoryResponse;
  }

  /**
   * Launch readiness — the DB-derived checks plus the env-derived payment-channel
   * check (booleans only, never a secret). Distinct from app health: a missing
   * payment channel makes launch-readiness false but never fails app health.
   */
  async getReadiness(): Promise<LaunchReadinessResponse> {
    const dbChecks = await loadBillingReadinessDbChecks(getPlatformAdminDb());
    const env = loadServerEnv();
    const channelsOk = Boolean(env.RASID_INSTAPAY_HANDLE && env.RASID_VODAFONE_CASH_NUMBER && env.RASID_BILLING_WHATSAPP_NUMBER);
    const envChecks: LaunchReadinessItem[] = [
      { check: "PAYMENT_CHANNELS_CONFIGURED", ok: channelsOk, detail: channelsOk ? "قنوات الدفع مهيّأة" : "قنوات الدفع (إنستاباي/فودافون/واتساب) غير مكتملة" },
      { check: "CUSTOM_FLOWS_ENABLED", ok: true, detail: "تدفقات الباقات المخصّصة مفعّلة" },
    ];
    const checks = [...dbChecks, ...envChecks];
    return { ready: computeLaunchReady(checks), checks };
  }

  async confirm(paymentRequestId: string, confirmedByUserId: string): Promise<ResolvePaymentRequestResponse> {
    await confirmPaymentRequestTransaction(getPlatformAdminDb(), { paymentRequestId, confirmedByUserId });
    return { paymentRequest: await this.requireDto(paymentRequestId) };
  }

  async reject(paymentRequestId: string, rejectedByUserId: string, reason: string): Promise<ResolvePaymentRequestResponse> {
    await rejectPaymentRequestTransaction(getPlatformAdminDb(), { paymentRequestId, rejectedByUserId, reason });
    return { paymentRequest: await this.requireDto(paymentRequestId) };
  }

  private async requireDto(id: string): Promise<PlatformPaymentRequestDto> {
    const row = await findPlatformPaymentRequestById(getPlatformAdminDb(), id);
    if (!row) throw new ResourceNotFoundException();
    return toPlatformDto(row);
  }
}

function toPlatformDto(row: PlatformPaymentRequestListRow): PlatformPaymentRequestDto {
  return {
    id: row.id,
    humanCode: row.humanCode,
    actionType: row.actionType as PlatformPaymentRequestDto["actionType"],
    targetPlanCode: row.targetPlanCode,
    billingCycle: row.billingCycle as BillingCycle,
    amountMinor: row.amountMinor,
    currencyCode: row.currencyCode,
    paymentMethod: row.paymentMethod as BillingPaymentMethod,
    status: row.status as PlatformPaymentRequestDto["status"],
    rejectReason: row.rejectReason,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    currentPlanCode: upgradeCurrentPlan(row),
    offerVersion: snapNumber(row, "offerVersion"),
    customMaxActiveStudents: row.targetPlanCode === "CUSTOM" ? snapNumber(row, "customMaxActiveStudents") : null,
    customMaxTeamMembers: row.targetPlanCode === "CUSTOM" ? snapNumber(row, "customMaxTeamMembers") : null,
  };
}

/** For an UPGRADE row, the plan being upgraded FROM (from the immutable quote snapshot). */
function upgradeCurrentPlan(row: PlatformPaymentRequestListRow): string | null {
  if (row.actionType !== "UPGRADE") return null;
  const snap = row.quoteSnapshotJson as { currentPlanCode?: unknown } | null;
  return snap && typeof snap === "object" && typeof snap.currentPlanCode === "string" ? snap.currentPlanCode : null;
}

function snapNumber(row: PlatformPaymentRequestListRow, key: string): number | null {
  const snap = row.quoteSnapshotJson as Record<string, unknown> | null;
  const v = snap && typeof snap === "object" ? snap[key] : undefined;
  return typeof v === "number" ? v : null;
}

function encodeCursor(c: { createdAt: string; id: string }): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}
function decodeCursor(raw?: string): { createdAt: string; id: string } | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { createdAt?: unknown; id?: unknown };
    if (typeof parsed.createdAt === "string" && typeof parsed.id === "string") return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    /* malformed cursor → start from the top */
  }
  return undefined;
}
