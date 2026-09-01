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
