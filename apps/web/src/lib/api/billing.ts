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
