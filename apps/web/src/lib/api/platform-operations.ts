import type {
  CreateFollowUpRequest,
  CreatePlatformContactLogRequest,
  FollowUp,
  ListFollowUpsResponse,
  ListPlatformContactLogsResponse,
  ListPlatformStaffResponse,
  PlatformContactLog,
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
