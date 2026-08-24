import type {
  SessionStartResponse,
  SessionRosterResponse,
  AttendanceBatchRequest,
  AttendanceBatchResponse,
  MarkAllPresentRequest,
  HomeworkBatchRequest,
  HomeworkBatchResponse,
  MarkAllDoneRequest,
  NoHomeworkRequest,
  ExamDefinitionRequest,
  ExamDefinitionResponse,
  ExamScoresBatchRequest,
  ExamScoresBatchResponse,
  SessionReviewResponse,
  SessionCompleteRequest,
  SessionCompleteResponse,
} from "@academic-precision/contracts";
import { apiRequest, newIdempotencyKey } from "./client";

export function startSession(workspaceId: string, sessionId: string, body: { version: number }): Promise<SessionStartResponse> {
  return apiRequest<SessionStartResponse>(`/sessions/${sessionId}/start`, { method: "POST", workspaceId, body });
}

export function fetchSessionRoster(workspaceId: string, sessionId: string): Promise<SessionRosterResponse> {
  return apiRequest<SessionRosterResponse>(`/sessions/${sessionId}/roster`, { workspaceId });
}

export function saveAttendance(workspaceId: string, sessionId: string, body: AttendanceBatchRequest): Promise<AttendanceBatchResponse> {
  return apiRequest<AttendanceBatchResponse>(`/sessions/${sessionId}/attendance`, { method: "PUT", workspaceId, body });
}

export function markAllPresent(workspaceId: string, sessionId: string, body: MarkAllPresentRequest): Promise<AttendanceBatchResponse> {
  return apiRequest<AttendanceBatchResponse>(`/sessions/${sessionId}/attendance/mark-all-present`, { method: "POST", workspaceId, body });
}

export function saveHomework(workspaceId: string, sessionId: string, body: HomeworkBatchRequest): Promise<HomeworkBatchResponse> {
  return apiRequest<HomeworkBatchResponse>(`/sessions/${sessionId}/homework`, { method: "PUT", workspaceId, body });
}

export function markAllHomeworkDone(workspaceId: string, sessionId: string, body: MarkAllDoneRequest): Promise<HomeworkBatchResponse> {
  return apiRequest<HomeworkBatchResponse>(`/sessions/${sessionId}/homework/mark-all-done`, { method: "POST", workspaceId, body });
}

export function markNoHomework(workspaceId: string, sessionId: string, body: NoHomeworkRequest): Promise<HomeworkBatchResponse> {
  return apiRequest<HomeworkBatchResponse>(`/sessions/${sessionId}/homework/no-homework`, { method: "POST", workspaceId, body });
}

export function defineExam(workspaceId: string, sessionId: string, body: ExamDefinitionRequest): Promise<ExamDefinitionResponse> {
  return apiRequest<ExamDefinitionResponse>(`/sessions/${sessionId}/exam`, { method: "PUT", workspaceId, body });
}

export function saveExamScores(workspaceId: string, sessionId: string, body: ExamScoresBatchRequest): Promise<ExamScoresBatchResponse> {
  return apiRequest<ExamScoresBatchResponse>(`/sessions/${sessionId}/exam/scores`, { method: "PUT", workspaceId, body });
}

export function fetchSessionReview(workspaceId: string, sessionId: string): Promise<SessionReviewResponse> {
  return apiRequest<SessionReviewResponse>(`/sessions/${sessionId}/review`, { workspaceId });
}

export function completeSession(workspaceId: string, sessionId: string, body: SessionCompleteRequest): Promise<SessionCompleteResponse> {
  return apiRequest<SessionCompleteResponse>(`/sessions/${sessionId}/complete`, { method: "POST", workspaceId, body, idempotencyKey: newIdempotencyKey() });
}
