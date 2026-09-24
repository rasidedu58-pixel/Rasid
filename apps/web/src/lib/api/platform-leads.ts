import type {
  ListPlatformLeadsResponse,
  PlatformLead,
  PlatformLeadMetrics,
  UpdatePlatformLeadRequest,
} from "@academic-precision/contracts";
import { apiRequest } from "./client";

/**
 * Platform Leads API client — Phase 16 Part B. Platform-Admin-only endpoints
 * behind PlatformAdminGuard + per-permission guard; an under-privileged caller
 * gets a plain 403.
 */
export function fetchPlatformLeads(params: { filter?: string; search?: string; limit?: number } = {}): Promise<ListPlatformLeadsResponse> {
  return apiRequest<ListPlatformLeadsResponse>("/platform-admin/leads", { query: params });
}

export function fetchPlatformLeadMetrics(): Promise<PlatformLeadMetrics> {
  return apiRequest<PlatformLeadMetrics>("/platform-admin/leads/metrics");
}

export function updatePlatformLead(id: string, body: UpdatePlatformLeadRequest): Promise<PlatformLead> {
  return apiRequest<PlatformLead>(`/platform-admin/leads/${id}`, { method: "PATCH", body });
}
