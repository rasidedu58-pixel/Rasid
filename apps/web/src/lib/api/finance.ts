import type { CollectionQueueResponse, FinanceSummaryResponse, PaymentLedgerResponse, RecordPaymentRequest, RecordPaymentResponse, ReversePaymentRequest, ReversePaymentResponse } from "@academic-precision/contracts";
import { apiRequest, newIdempotencyKey } from "./client";

export function fetchCollectionQueue(workspaceId: string, cursor?: string): Promise<CollectionQueueResponse> {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return apiRequest<CollectionQueueResponse>(`/finance/collection-queue${qs}`, { workspaceId });
}

export function fetchPaymentLedger(
  workspaceId: string,
  params: { cursor?: string; from?: string; to?: string; method?: string; status?: string } = {},
): Promise<PaymentLedgerResponse> {
  return apiRequest<PaymentLedgerResponse>("/finance/payments", { workspaceId, query: params });
}

export function fetchFinanceSummary(workspaceId: string): Promise<FinanceSummaryResponse> {
  return apiRequest<FinanceSummaryResponse>("/finance/summary", { workspaceId });
}

export function recordPayment(workspaceId: string, body: RecordPaymentRequest): Promise<RecordPaymentResponse> {
  return apiRequest<RecordPaymentResponse>("/payments", { method: "POST", workspaceId, body, idempotencyKey: newIdempotencyKey() });
}

export function reversePayment(workspaceId: string, paymentId: string, body: ReversePaymentRequest): Promise<ReversePaymentResponse> {
  return apiRequest<ReversePaymentResponse>(`/payments/${paymentId}/reverse`, { method: "POST", workspaceId, body, idempotencyKey: newIdempotencyKey() });
}
