import type {
  ListPlatformAdminSubscriptionsResponse,
  ListPlatformAdminUsersResponse,
  ListPlatformAdminWorkspacesResponse,
  PlatformAdminDashboardResponse,
  PlatformAdminUserDetail,
  PlatformAdminWorkspaceDetail,
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

export function fetchPlatformAdminWorkspaces(params: { search?: string; cursor?: string; limit?: number } = {}): Promise<ListPlatformAdminWorkspacesResponse> {
  return apiRequest<ListPlatformAdminWorkspacesResponse>("/platform-admin/workspaces", { query: params });
}

export function fetchPlatformAdminWorkspace(workspaceId: string): Promise<PlatformAdminWorkspaceDetail> {
  return apiRequest<PlatformAdminWorkspaceDetail>(`/platform-admin/workspaces/${workspaceId}`);
}

export function fetchPlatformAdminSubscriptions(params: { state?: string; cursor?: string; limit?: number } = {}): Promise<ListPlatformAdminSubscriptionsResponse> {
  return apiRequest<ListPlatformAdminSubscriptionsResponse>("/platform-admin/subscriptions", { query: params });
}
