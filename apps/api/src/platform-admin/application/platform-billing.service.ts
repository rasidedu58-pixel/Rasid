import { Injectable } from "@nestjs/common";
import {
  confirmPaymentRequestTransaction,
  findPlatformPaymentRequestById,
  getPlatformAdminDb,
  listPlatformPaymentRequests,
  rejectPaymentRequestTransaction,
  type PlatformPaymentRequestListRow,
} from "@academic-precision/database";
import type {
  BillingCycle,
  BillingPaymentMethod,
  ListPlatformPaymentRequestsResponse,
  PlatformPaymentRequestDto,
  ResolvePaymentRequestResponse,
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
