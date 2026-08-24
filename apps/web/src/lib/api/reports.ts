import type {
  StudentReportResponse,
  GroupReportResponse,
  MonthlyTeacherReportResponse,
  CreateReportExportRequest,
  CreateReportExportResponse,
  GetExportResponse,
  ListNotificationsResponse,
  MarkNotificationReadResponse,
  MarkAllNotificationsReadResponse,
  ActionCenterResponse,
} from "@academic-precision/contracts";
import { apiRequest } from "./client";

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

/** Raw UTF-8 CSV text — no PDF/XLSX exists in this product; never invent one. */
export function downloadExportCsv(workspaceId: string, exportId: string): Promise<string> {
  return apiRequest<string>(`/exports/${exportId}/download`, { workspaceId, raw: true });
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

export function fetchActionCenter(workspaceId: string): Promise<ActionCenterResponse> {
  return apiRequest<ActionCenterResponse>("/action-center", { workspaceId });
}
