import type {
  ListAttentionCasesResponse,
  AttentionCase,
  AttentionCaseTransitionRequest,
  AttentionCaseTransitionResponse,
  ContactDraftRequest,
  ContactDraftResponse,
  CreateContactLogRequest,
  CreateContactLogResponse,
  ListFollowupsResponse,
  CompleteFollowupRequest,
  RescheduleFollowupRequest,
  FollowupActionResponse,
} from "@academic-precision/contracts";
import { apiRequest } from "./client";

export function fetchAttentionCases(workspaceId: string, params: { status?: string; cursor?: string; limit?: number } = {}): Promise<ListAttentionCasesResponse> {
  return apiRequest<ListAttentionCasesResponse>("/attention-cases", { workspaceId, query: params });
}

export function fetchAttentionCase(workspaceId: string, caseId: string): Promise<AttentionCase> {
  return apiRequest<AttentionCase>(`/attention-cases/${caseId}`, { workspaceId });
}

export function startFollowup(workspaceId: string, caseId: string, body: AttentionCaseTransitionRequest): Promise<AttentionCaseTransitionResponse> {
  return apiRequest<AttentionCaseTransitionResponse>(`/attention-cases/${caseId}/start-followup`, { method: "POST", workspaceId, body });
}

export function markMonitoring(workspaceId: string, caseId: string, body: AttentionCaseTransitionRequest): Promise<AttentionCaseTransitionResponse> {
  return apiRequest<AttentionCaseTransitionResponse>(`/attention-cases/${caseId}/mark-monitoring`, { method: "POST", workspaceId, body });
}

export function closeAttentionCase(workspaceId: string, caseId: string, body: AttentionCaseTransitionRequest): Promise<AttentionCaseTransitionResponse> {
  return apiRequest<AttentionCaseTransitionResponse>(`/attention-cases/${caseId}/close`, { method: "POST", workspaceId, body });
}

export function draftContact(workspaceId: string, caseId: string, body: ContactDraftRequest): Promise<ContactDraftResponse> {
  return apiRequest<ContactDraftResponse>(`/attention-cases/${caseId}/contact-draft`, { method: "POST", workspaceId, body });
}

export function createContactLog(workspaceId: string, body: CreateContactLogRequest): Promise<CreateContactLogResponse> {
  return apiRequest<CreateContactLogResponse>("/contact-logs", { method: "POST", workspaceId, body });
}

export function fetchFollowups(workspaceId: string, params: { status?: string; cursor?: string; limit?: number } = {}): Promise<ListFollowupsResponse> {
  return apiRequest<ListFollowupsResponse>("/followups", { workspaceId, query: params });
}

export function completeFollowup(workspaceId: string, followupId: string, body: CompleteFollowupRequest): Promise<FollowupActionResponse> {
  return apiRequest<FollowupActionResponse>(`/followups/${followupId}/complete`, { method: "POST", workspaceId, body });
}

export function rescheduleFollowup(workspaceId: string, followupId: string, body: RescheduleFollowupRequest): Promise<FollowupActionResponse> {
  return apiRequest<FollowupActionResponse>(`/followups/${followupId}/reschedule`, { method: "POST", workspaceId, body });
}
