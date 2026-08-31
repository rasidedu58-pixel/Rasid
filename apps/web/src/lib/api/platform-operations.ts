import type {
  ChangePlatformStaffRoleRequest,
  CreateCustomerInvitationRequest,
  CreateCustomerInvitationResponse,
  CreateFollowUpRequest,
  CreateMonthOverrideRequest,
  CreatePlatformContactLogRequest,
  CreatePlatformStaffInvitationRequest,
  CreatePlatformStaffInvitationResponse,
  FollowUp,
  ListCustomerInvitationsResponse,
  ListFollowUpsResponse,
  ListMonthOverridesResponse,
  ListPlatformContactLogsResponse,
  ListPlatformStaffInvitationsResponse,
  ListPlatformStaffMembersResponse,
  ListPlatformStaffResponse,
  ListWorkspaceFeaturesResponse,
  PlatformContactLog,
  PlatformStaffAccountActionRequest,
  RevokeFeatureOverrideRequest,
  SetFeatureOverrideRequest,
  UpdateFollowUpRequest,
} from "@academic-precision/contracts";
import { apiRequest } from "./client";

/**
 * Platform Operations API client — Unit 1 (Customer Communication +
 * Follow-up). WRITE endpoints behind PlatformAdminGuard + per-permission
 * guard; an under-privileged staff member gets a plain 403.
 */

// --- Contact logs -----------------------------------------------------------
export function fetchWorkspaceContactLogs(workspaceId: string, params: { cursor?: string; limit?: number } = {}): Promise<ListPlatformContactLogsResponse> {
  return apiRequest<ListPlatformContactLogsResponse>(`/platform-admin/workspaces/${workspaceId}/contact-logs`, { query: params });
}

export function createWorkspaceContactLog(workspaceId: string, body: CreatePlatformContactLogRequest): Promise<PlatformContactLog> {
  return apiRequest<PlatformContactLog>(`/platform-admin/workspaces/${workspaceId}/contact-logs`, { method: "POST", body });
}

// --- Follow-ups -------------------------------------------------------------
export function fetchFollowUpQueue(params: { status?: string; assignedToUserId?: string; workspaceId?: string; cursor?: string; limit?: number } = {}): Promise<ListFollowUpsResponse> {
  return apiRequest<ListFollowUpsResponse>("/platform-admin/follow-ups", { query: params });
}

export function fetchWorkspaceFollowUps(workspaceId: string, params: { status?: string; cursor?: string; limit?: number } = {}): Promise<ListFollowUpsResponse> {
  return apiRequest<ListFollowUpsResponse>(`/platform-admin/workspaces/${workspaceId}/follow-ups`, { query: params });
}

export function createWorkspaceFollowUp(workspaceId: string, body: CreateFollowUpRequest): Promise<FollowUp> {
  return apiRequest<FollowUp>(`/platform-admin/workspaces/${workspaceId}/follow-ups`, { method: "POST", body });
}

export function updateFollowUp(followUpId: string, body: UpdateFollowUpRequest): Promise<FollowUp> {
  return apiRequest<FollowUp>(`/platform-admin/follow-ups/${followUpId}`, { method: "PATCH", body });
}

// --- Staff ------------------------------------------------------------------
export function fetchPlatformStaff(): Promise<ListPlatformStaffResponse> {
  return apiRequest<ListPlatformStaffResponse>("/platform-admin/staff");
}

// --- Operating-Month Overrides ----------------------------------------------
export function fetchWorkspaceMonthOverrides(workspaceId: string): Promise<ListMonthOverridesResponse> {
  return apiRequest<ListMonthOverridesResponse>(`/platform-admin/workspaces/${workspaceId}/operating-month-overrides`);
}

export function createWorkspaceMonthOverride(workspaceId: string, body: CreateMonthOverrideRequest): Promise<{ id: string }> {
  return apiRequest<{ id: string }>(`/platform-admin/workspaces/${workspaceId}/operating-month-overrides`, { method: "POST", body });
}

export function revokeMonthOverride(overrideId: string): Promise<void> {
  return apiRequest<void>(`/platform-admin/operating-month-overrides/${overrideId}`, { method: "DELETE" });
}

// --- Customer & Subscription Controls ---------------------------------------
export function customerAccountAction(workspaceId: string, body: { action: "SUSPEND" | "REACTIVATE"; reason: string }): Promise<{ status: string }> {
  return apiRequest<{ status: string }>(`/platform-admin/workspaces/${workspaceId}/account-action`, { method: "POST", body });
}

export function editCustomer(workspaceId: string, body: { name?: string; ownerPhone?: string | null; reason: string }): Promise<{ name: string; ownerPhone: string | null }> {
  return apiRequest<{ name: string; ownerPhone: string | null }>(`/platform-admin/workspaces/${workspaceId}/customer`, { method: "PATCH", body });
}

export function subscriptionAdminAction(
  workspaceId: string,
  body: { action: "EXTEND_DAYS" | "SET_END_DATE" | "SUSPEND" | "REACTIVATE"; reason: string; days?: number; endDate?: string },
): Promise<{ state: string; periodEnd: string | null }> {
  return apiRequest<{ state: string; periodEnd: string | null }>(`/platform-admin/workspaces/${workspaceId}/subscription-action`, { method: "POST", body });
}

// --- Platform Staff Management ("فريق راصد") --------------------------------
export function fetchPlatformStaffMembers(): Promise<ListPlatformStaffMembersResponse> {
  return apiRequest<ListPlatformStaffMembersResponse>("/platform-admin/staff-members");
}

export function fetchPlatformStaffInvitations(): Promise<ListPlatformStaffInvitationsResponse> {
  return apiRequest<ListPlatformStaffInvitationsResponse>("/platform-admin/staff-invitations");
}

export function createPlatformStaffInvitation(body: CreatePlatformStaffInvitationRequest): Promise<CreatePlatformStaffInvitationResponse> {
  return apiRequest<CreatePlatformStaffInvitationResponse>("/platform-admin/staff-invitations", { method: "POST", body });
}

export function revokePlatformStaffInvitation(id: string): Promise<{ id: string; status: "REVOKED" }> {
  return apiRequest<{ id: string; status: "REVOKED" }>(`/platform-admin/staff-invitations/${id}/revoke`, { method: "POST" });
}

export function changePlatformStaffRole(userId: string, body: ChangePlatformStaffRoleRequest): Promise<{ userId: string; role: string }> {
  return apiRequest<{ userId: string; role: string }>(`/platform-admin/staff-members/${userId}/role`, { method: "PATCH", body });
}

export function platformStaffAccountAction(userId: string, body: PlatformStaffAccountActionRequest): Promise<{ userId: string; status: string }> {
  return apiRequest<{ userId: string; status: string }>(`/platform-admin/staff-members/${userId}/account-action`, { method: "POST", body });
}

// --- Customer Creation via Secure Invite ------------------------------------
export function fetchCustomerInvitations(params: { cursor?: string; limit?: number } = {}): Promise<ListCustomerInvitationsResponse> {
  return apiRequest<ListCustomerInvitationsResponse>("/platform-admin/customer-invitations", { query: params });
}

export function createCustomerInvitation(body: CreateCustomerInvitationRequest): Promise<CreateCustomerInvitationResponse> {
  return apiRequest<CreateCustomerInvitationResponse>("/platform-admin/customer-invitations", { method: "POST", body });
}

export function revokeCustomerInvitation(id: string): Promise<{ id: string; status: "REVOKED" }> {
  return apiRequest<{ id: string; status: "REVOKED" }>(`/platform-admin/customer-invitations/${id}/revoke`, { method: "POST" });
}

// --- Workspace Feature Overrides --------------------------------------------
export function fetchWorkspaceFeatures(workspaceId: string): Promise<ListWorkspaceFeaturesResponse> {
  return apiRequest<ListWorkspaceFeaturesResponse>(`/platform-admin/workspaces/${workspaceId}/features`);
}

export function setFeatureOverride(workspaceId: string, body: SetFeatureOverrideRequest): Promise<{ featureKey: string; state: string }> {
  return apiRequest<{ featureKey: string; state: string }>(`/platform-admin/workspaces/${workspaceId}/feature-override`, { method: "POST", body });
}

export function revokeFeatureOverride(workspaceId: string, body: RevokeFeatureOverrideRequest): Promise<{ featureKey: string }> {
  return apiRequest<{ featureKey: string }>(`/platform-admin/workspaces/${workspaceId}/feature-override/revoke`, { method: "POST", body });
}
