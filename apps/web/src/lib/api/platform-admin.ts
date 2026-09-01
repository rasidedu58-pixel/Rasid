import type {
  ListPlatformAdminSubscriptionsResponse,
  ListPlatformAdminUsersResponse,
  ListPlatformAdminWorkspacesResponse,
  PlatformActivityResponse,
  PlatformAdminDashboardResponse,
  PlatformAdminUserDetail,
  PlatformAdminWorkspaceDetail,
  PlatformNeedsAttentionResponse,
  PlatformOperationalSnapshot,
  PlatformStatusResponse,
  PlatformWorkspaceSubscriptionResponse,
  ListPlatformPaymentRequestsResponse,
  ResolvePaymentRequestResponse,
  RejectPaymentRequest,
} from "@academic-precision/contracts";
import { apiRequest } from "./client";

/**
 * Platform Admin API client — Phase 12. No `workspaceId` is ever passed
 * here (no `X-Workspace-Id` header sent) — these routes sit behind
 * `SupabaseAuthGuard` + `PlatformAdminGuard` only, never `PermissionGuard`.
 * A non-platform-admin caller gets a plain 403 from every one of these —
 * the frontend pages render `PermissionDeniedState` for that, never a
 * crash (see `isForbidden` in `./client`).
 */
export function fetchPlatformAdminDashboard(): Promise<PlatformAdminDashboardResponse> {
  return apiRequest<PlatformAdminDashboardResponse>("/platform-admin/dashboard");
}

export function fetchPlatformAdminUsers(params: { search?: string; cursor?: string; limit?: number } = {}): Promise<ListPlatformAdminUsersResponse> {
  return apiRequest<ListPlatformAdminUsersResponse>("/platform-admin/users", { query: params });
}

export function fetchPlatformAdminUser(userId: string): Promise<PlatformAdminUserDetail> {
  return apiRequest<PlatformAdminUserDetail>(`/platform-admin/users/${userId}`);
}

export function fetchPlatformAdminWorkspaces(
  params: { search?: string; state?: string; governorate?: string; subject?: string; cursor?: string; limit?: number } = {},
): Promise<ListPlatformAdminWorkspacesResponse> {
  return apiRequest<ListPlatformAdminWorkspacesResponse>("/platform-admin/workspaces", { query: params });
}

export function fetchPlatformAdminWorkspace(workspaceId: string): Promise<PlatformAdminWorkspaceDetail> {
  return apiRequest<PlatformAdminWorkspaceDetail>(`/platform-admin/workspaces/${workspaceId}`);
}

export function fetchPlatformAdminSubscriptions(params: { state?: string; cursor?: string; limit?: number } = {}): Promise<ListPlatformAdminSubscriptionsResponse> {
  return apiRequest<ListPlatformAdminSubscriptionsResponse>("/platform-admin/subscriptions", { query: params });
}

export function fetchPlatformNeedsAttention(): Promise<PlatformNeedsAttentionResponse> {
  return apiRequest<PlatformNeedsAttentionResponse>("/platform-admin/needs-attention");
}

export function fetchPlatformActivity(): Promise<PlatformActivityResponse> {
  return apiRequest<PlatformActivityResponse>("/platform-admin/activity");
}

export function fetchPlatformWorkspaceOperational(workspaceId: string): Promise<PlatformOperationalSnapshot> {
  return apiRequest<PlatformOperationalSnapshot>(`/platform-admin/workspaces/${workspaceId}/operational`);
}

/** Sensitive billing read — the API gates this with platform.subscriptions.view (403 for SUPPORT_AGENT). */
export function fetchPlatformWorkspaceSubscription(workspaceId: string): Promise<PlatformWorkspaceSubscriptionResponse> {
  return apiRequest<PlatformWorkspaceSubscriptionResponse>(`/platform-admin/workspaces/${workspaceId}/subscription`);
}

/** Platform status + derived active issues (platform.health.view). */
export function fetchPlatformStatus(): Promise<PlatformStatusResponse> {
  return apiRequest<PlatformStatusResponse>("/platform-admin/platform-status");
}

// --- Billing Phase 3: payment requests (Billing Center) ----------------------

/** platform.billing.view */
export function fetchPlatformPaymentRequests(
  params: { status?: string; cursor?: string; limit?: number } = {},
): Promise<ListPlatformPaymentRequestsResponse> {
  return apiRequest<ListPlatformPaymentRequestsResponse>("/platform-admin/payment-requests", { query: params });
}

/** platform.billing.manage — confirm creates an immutable payment + activates the subscription. */
export function confirmPaymentRequest(id: string): Promise<ResolvePaymentRequestResponse> {
  return apiRequest<ResolvePaymentRequestResponse>(`/platform-admin/payment-requests/${id}/confirm`, { method: "POST", body: {} });
}

/** platform.billing.manage — reject (reason mandatory), no payment, no subscription change. */
export function rejectPaymentRequest(id: string, body: RejectPaymentRequest): Promise<ResolvePaymentRequestResponse> {
  return apiRequest<ResolvePaymentRequestResponse>(`/platform-admin/payment-requests/${id}/reject`, { method: "POST", body });
}
