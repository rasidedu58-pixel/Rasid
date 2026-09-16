import {
  actionCenterResponseSchema,
  type StudentReportResponse,
  type GroupReportResponse,
  type MonthlyTeacherReportResponse,
  type CreateReportExportRequest,
  type CreateReportExportResponse,
  type GetExportResponse,
  type ListNotificationsResponse,
  type MarkNotificationReadResponse,
  type MarkAllNotificationsReadResponse,
  type ActionCenterResponse,
} from "@academic-precision/contracts";
import { apiDownload, apiRequest } from "./client";

export function fetchStudentReport(workspaceId: string, studentId: string): Promise<StudentReportResponse> {
  return apiRequest<StudentReportResponse>(`/reports/student/${studentId}`, { workspaceId });
}

export function fetchGroupReport(workspaceId: string, groupId: string): Promise<GroupReportResponse> {
  return apiRequest<GroupReportResponse>(`/reports/group/${groupId}`, { workspaceId });
}

export function fetchMonthlyReport(workspaceId: string, monthId: string): Promise<MonthlyTeacherReportResponse> {
  return apiRequest<MonthlyTeacherReportResponse>(`/reports/monthly/${monthId}`, { workspaceId });
}

export function createReportExport(workspaceId: string, body: CreateReportExportRequest): Promise<CreateReportExportResponse> {
  return apiRequest<CreateReportExportResponse>("/reports/export", { method: "POST", workspaceId, body });
}

export function fetchExportStatus(workspaceId: string, exportId: string): Promise<GetExportResponse> {
  return apiRequest<GetExportResponse>(`/exports/${exportId}`, { workspaceId });
}

/** Downloads a ready export (CSV / XLSX / PDF) as a Blob + server filename. */
export function downloadExportFile(workspaceId: string, exportId: string): Promise<{ blob: Blob; filename: string | null }> {
  return apiDownload(`/exports/${exportId}/download`, { workspaceId });
}

// --- Notifications ---------------------------------------------------------

export function fetchNotifications(workspaceId: string): Promise<ListNotificationsResponse> {
  return apiRequest<ListNotificationsResponse>("/notifications", { workspaceId });
}

export function markNotificationRead(workspaceId: string, notificationId: string): Promise<MarkNotificationReadResponse> {
  return apiRequest<MarkNotificationReadResponse>(`/notifications/${notificationId}/read`, { method: "POST", workspaceId });
}

export function markAllNotificationsRead(workspaceId: string): Promise<MarkAllNotificationsReadResponse> {
  return apiRequest<MarkAllNotificationsReadResponse>("/notifications/read-all", { method: "POST", workspaceId });
}

// --- Action Center -----------------------------------------------------

/**
 * `GET /action-center` — the dashboard aggregate. Parsed through the
 * contract schema for the same rolling-deploy safety pattern as
 * `fetchOnboardingStatus`: an old-shape payload (a paired API still on
 * a pre-durationMinutes / pre-missedSessions build during rollout) is
 * validated by the OPTIONAL fields of `actionCenterResponseSchema` and
 * passes cleanly; a genuinely-broken response fails LOUDLY at fetch time
 * (React Query error state) instead of silently populating a partial
 * object that crashes downstream renders.
 */
export async function fetchActionCenter(workspaceId: string): Promise<ActionCenterResponse> {
  const raw = await apiRequest<unknown>("/action-center", { workspaceId });
  return actionCenterResponseSchema.parse(raw);
}
