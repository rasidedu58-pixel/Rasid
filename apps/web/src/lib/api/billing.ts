import type {
  GetSubscriptionResponse,
  CreateCheckoutRequest,
  CreateCheckoutResponse,
  CreatePortalRequest,
  CreatePortalResponse,
  ListEntitlementsResponse,
  CreatePaymentRequest,
  CreatePaymentRequestResponse,
  ListPaymentRequestsResponse,
  GetBillingPlanStateResponse,
  UpgradeQuoteRequest,
  UpgradeQuoteResponse,
  ScheduleDowngradeRequest,
  ScheduleDowngradeResponse,
  CreateCustomRequest,
  CreateCustomPaymentRequest,
  GetCustomPlanStateResponse,
  CustomOfferDto,
  CustomRequestDto,
  ListBillingHistoryResponse,
} from "@academic-precision/contracts";
import { apiRequest } from "./client";

export function fetchSubscription(workspaceId: string): Promise<GetSubscriptionResponse> {
  return apiRequest<GetSubscriptionResponse>("/billing/subscription", { workspaceId });
}

export function createCheckout(workspaceId: string, body: CreateCheckoutRequest): Promise<CreateCheckoutResponse> {
  return apiRequest<CreateCheckoutResponse>("/billing/checkout", { method: "POST", workspaceId, body });
}

export function createPortalSession(workspaceId: string, body: CreatePortalRequest): Promise<CreatePortalResponse> {
  return apiRequest<CreatePortalResponse>("/billing/portal", { method: "POST", workspaceId, body });
}

export function fetchEntitlements(workspaceId: string): Promise<ListEntitlementsResponse> {
  return apiRequest<ListEntitlementsResponse>("/entitlements", { workspaceId });
}

// --- Billing Phase 3: manual payment requests --------------------------------

export function createPaymentRequest(workspaceId: string, body: CreatePaymentRequest): Promise<CreatePaymentRequestResponse> {
  return apiRequest<CreatePaymentRequestResponse>("/billing/payment-requests", { method: "POST", workspaceId, body });
}

export function listPaymentRequests(workspaceId: string): Promise<ListPaymentRequestsResponse> {
  return apiRequest<ListPaymentRequestsResponse>("/billing/payment-requests", { workspaceId });
}

// --- Billing Phase 4: plan state + upgrade quote + scheduled downgrade --------

export function fetchBillingPlanState(workspaceId: string): Promise<GetBillingPlanStateResponse> {
  return apiRequest<GetBillingPlanStateResponse>("/billing/plan-state", { workspaceId });
}

export function quoteUpgrade(workspaceId: string, body: UpgradeQuoteRequest): Promise<UpgradeQuoteResponse> {
  return apiRequest<UpgradeQuoteResponse>("/billing/upgrade-quote", { method: "POST", workspaceId, body });
}

export function scheduleDowngrade(workspaceId: string, body: ScheduleDowngradeRequest): Promise<ScheduleDowngradeResponse> {
  return apiRequest<ScheduleDowngradeResponse>("/billing/downgrade/schedule", { method: "POST", workspaceId, body });
}

export function cancelDowngrade(workspaceId: string): Promise<ScheduleDowngradeResponse> {
  return apiRequest<ScheduleDowngradeResponse>("/billing/downgrade/cancel", { method: "POST", workspaceId, body: {} });
}

// --- Billing Phase 5: custom plans -------------------------------------------

export function fetchCustomState(workspaceId: string): Promise<GetCustomPlanStateResponse> {
  return apiRequest<GetCustomPlanStateResponse>("/billing/custom/state", { workspaceId });
}
export function createCustomRequest(workspaceId: string, body: CreateCustomRequest): Promise<{ request: CustomRequestDto }> {
  return apiRequest<{ request: CustomRequestDto }>("/billing/custom/requests", { method: "POST", workspaceId, body });
}
export function cancelCustomRequest(workspaceId: string): Promise<{ request: CustomRequestDto }> {
  return apiRequest<{ request: CustomRequestDto }>("/billing/custom/requests/cancel", { method: "POST", workspaceId, body: {} });
}
export function acceptCustomOffer(workspaceId: string, offerId: string): Promise<{ offer: CustomOfferDto }> {
  return apiRequest<{ offer: CustomOfferDto }>(`/billing/custom/offers/${offerId}/accept`, { method: "POST", workspaceId, body: {} });
}
export function rejectCustomOffer(workspaceId: string, offerId: string): Promise<{ offer: CustomOfferDto }> {
  return apiRequest<{ offer: CustomOfferDto }>(`/billing/custom/offers/${offerId}/reject`, { method: "POST", workspaceId, body: {} });
}
export function createCustomPayment(workspaceId: string, body: CreateCustomPaymentRequest): Promise<CreatePaymentRequestResponse> {
  return apiRequest<CreatePaymentRequestResponse>("/billing/custom/payment-request", { method: "POST", workspaceId, body });
}

// --- Billing Phase 6: unified billing history (owner-only) -------------------

export function fetchBillingHistory(workspaceId: string, cursor?: string): Promise<ListBillingHistoryResponse> {
  return apiRequest<ListBillingHistoryResponse>("/billing/history", { workspaceId, query: { cursor, limit: 20 } });
}
