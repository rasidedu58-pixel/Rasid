import type {
  ListMonthsResponse,
  OperatingMonth,
  CreateMonthPreviewRequest,
  CreateMonthPreviewResponse,
  CreateMonthConfirmRequest,
  CreateMonthConfirmResponse,
  ListGroupMonthsResponse,
  ListGroupsResponse,
  Group,
  CreateGroupRequest,
  UpdateGroupRequest,
  GroupMonth,
  GroupMonthChangePreviewRequest,
  GroupMonthChangePreviewResponse,
  GroupMonthApplyChangeRequest,
  GroupMonthApplyChangeResponse,
  ListScheduleRulesResponse,
  SchedulePreviewRequest,
  SchedulePreviewResponse,
  ScheduleApplyRequest,
  ScheduleApplyResponse,
  ListSessionsResponse,
  Session,
  SessionCancelResponse,
  SessionReschedulePreviewRequest,
  SessionReschedulePreviewResponse,
  SessionRescheduleRequest,
  SessionRescheduleResponse,
} from "@academic-precision/contracts";
import { apiRequest, newIdempotencyKey } from "./client";

// --- Operating months --------------------------------------------------

export function fetchMonths(workspaceId: string): Promise<ListMonthsResponse> {
  return apiRequest<ListMonthsResponse>("/months", { workspaceId });
}

export function fetchMonth(workspaceId: string, monthId: string): Promise<OperatingMonth> {
  return apiRequest<OperatingMonth>(`/months/${monthId}`, { workspaceId });
}

export function previewCreateMonth(workspaceId: string, body: CreateMonthPreviewRequest): Promise<CreateMonthPreviewResponse> {
  return apiRequest<CreateMonthPreviewResponse>("/months/preview", { method: "POST", workspaceId, body });
}

export function confirmCreateMonth(workspaceId: string, body: CreateMonthConfirmRequest): Promise<CreateMonthConfirmResponse> {
  return apiRequest<CreateMonthConfirmResponse>("/months", { method: "POST", workspaceId, body, idempotencyKey: newIdempotencyKey() });
}

/** Resolves each Group's GroupMonth id for a given OperatingMonth — see the contract's own comment for why this endpoint exists. */
export function fetchGroupMonthsForMonth(workspaceId: string, monthId: string): Promise<ListGroupMonthsResponse> {
  return apiRequest<ListGroupMonthsResponse>(`/months/${monthId}/group-months`, { workspaceId });
}

// --- Groups --------------------------------------------------------------

export function fetchGroups(workspaceId: string): Promise<ListGroupsResponse> {
  return apiRequest<ListGroupsResponse>("/groups", { workspaceId });
}

export function fetchGroup(workspaceId: string, groupId: string): Promise<Group> {
  return apiRequest<Group>(`/groups/${groupId}`, { workspaceId });
}

export function createGroup(workspaceId: string, body: CreateGroupRequest): Promise<Group> {
  return apiRequest<Group>("/groups", { method: "POST", workspaceId, body });
}

export function updateGroup(workspaceId: string, groupId: string, body: UpdateGroupRequest): Promise<Group> {
  return apiRequest<Group>(`/groups/${groupId}`, { method: "PATCH", workspaceId, body });
}

// --- Group months (monthly operational config) ----------------------------

export function fetchGroupMonth(workspaceId: string, groupMonthId: string): Promise<GroupMonth> {
  return apiRequest<GroupMonth>(`/group-months/${groupMonthId}`, { workspaceId });
}

export function previewGroupMonthChange(workspaceId: string, groupMonthId: string, body: GroupMonthChangePreviewRequest): Promise<GroupMonthChangePreviewResponse> {
  return apiRequest<GroupMonthChangePreviewResponse>(`/group-months/${groupMonthId}/change-preview`, { method: "POST", workspaceId, body });
}

export function applyGroupMonthChange(workspaceId: string, groupMonthId: string, body: GroupMonthApplyChangeRequest): Promise<GroupMonthApplyChangeResponse> {
  return apiRequest<GroupMonthApplyChangeResponse>(`/group-months/${groupMonthId}/apply-change`, { method: "POST", workspaceId, body });
}

export function fetchGroupMonthSchedule(workspaceId: string, groupMonthId: string): Promise<ListScheduleRulesResponse> {
  return apiRequest<ListScheduleRulesResponse>(`/group-months/${groupMonthId}/schedule`, { workspaceId });
}

export function previewSchedule(workspaceId: string, groupMonthId: string, body: SchedulePreviewRequest): Promise<SchedulePreviewResponse> {
  return apiRequest<SchedulePreviewResponse>(`/group-months/${groupMonthId}/schedule/preview`, { method: "POST", workspaceId, body });
}

export function applySchedule(workspaceId: string, groupMonthId: string, body: ScheduleApplyRequest): Promise<ScheduleApplyResponse> {
  return apiRequest<ScheduleApplyResponse>(`/group-months/${groupMonthId}/schedule/apply`, { method: "POST", workspaceId, body });
}

// --- Sessions (schedule-level operations; Session Mode lives in session-mode.ts) ---

export function fetchSessions(workspaceId: string, params: { groupMonthId?: string; status?: string; from?: string; to?: string; cursor?: string; limit?: number } = {}): Promise<ListSessionsResponse> {
  return apiRequest<ListSessionsResponse>("/sessions", { workspaceId, query: params });
}

export function fetchSession(workspaceId: string, sessionId: string): Promise<Session> {
  return apiRequest<Session>(`/sessions/${sessionId}`, { workspaceId });
}

export function cancelSession(workspaceId: string, sessionId: string): Promise<SessionCancelResponse> {
  return apiRequest<SessionCancelResponse>(`/sessions/${sessionId}/cancel`, { method: "POST", workspaceId });
}

export function previewSessionReschedule(workspaceId: string, sessionId: string, body: SessionReschedulePreviewRequest): Promise<SessionReschedulePreviewResponse> {
  return apiRequest<SessionReschedulePreviewResponse>(`/sessions/${sessionId}/reschedule-preview`, { method: "POST", workspaceId, body });
}

export function rescheduleSession(workspaceId: string, sessionId: string, body: SessionRescheduleRequest): Promise<SessionRescheduleResponse> {
  return apiRequest<SessionRescheduleResponse>(`/sessions/${sessionId}/reschedule`, { method: "POST", workspaceId, body });
}
