import type { CollectionQueueResponse, FinanceSummaryResponse, RecordPaymentRequest, RecordPaymentResponse, ReversePaymentRequest, ReversePaymentResponse } from "@academic-precision/contracts";
import { apiRequest, newIdempotencyKey } from "./client";

export function fetchCollectionQueue(workspaceId: string): Promise<CollectionQueueResponse> {
  return apiRequest<CollectionQueueResponse>("/finance/collection-queue", { workspaceId });
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
