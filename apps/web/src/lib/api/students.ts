import type {
  ListStudentsResponse,
  StudentDetailResponse,
  Student,
  CreateStudentRequest,
  CreateStudentResponse,
  UpdateStudentRequest,
  MatchPreviewRequest,
  MatchPreviewResponse,
  LinkGuardianRequest,
  GuardianLink,
  UpdateStudentGuardianRequest,
  QrIssueResponse,
  QrReissueRequest,
  QrResolveRequest,
  QrResolveResponse,
  EnrollmentPreviewRequest,
  EnrollmentPreviewResponse,
  EnrollmentCreateRequest,
  EnrollmentCreateResponse,
  EnrollmentBatchRequest,
  EnrollmentBatchResponse,
  EnrollmentWithdrawRequest,
  EnrollmentWithdrawResponse,
  EnrollmentTransferPreviewRequest,
  EnrollmentTransferPreviewResponse,
  EnrollmentTransferRequest,
  EnrollmentTransferResponse,
  StudentObligationsResponse,
  ListStudentEnrollmentsResponse,
} from "@academic-precision/contracts";
import { apiRequest } from "./client";

export function fetchStudents(workspaceId: string, params: { q?: string; searchBy?: string; cursor?: string; limit?: number } = {}): Promise<ListStudentsResponse> {
  return apiRequest<ListStudentsResponse>("/students", { workspaceId, query: params });
}

export function fetchStudentDetail(workspaceId: string, studentId: string): Promise<StudentDetailResponse> {
  return apiRequest<StudentDetailResponse>(`/students/${studentId}`, { workspaceId });
}

export function fetchStudentObligations(workspaceId: string, studentId: string): Promise<StudentObligationsResponse> {
  return apiRequest<StudentObligationsResponse>(`/students/${studentId}/obligations`, { workspaceId });
}

export function fetchStudentEnrollments(workspaceId: string, studentId: string): Promise<ListStudentEnrollmentsResponse> {
  return apiRequest<ListStudentEnrollmentsResponse>(`/students/${studentId}/enrollments`, { workspaceId });
}

export function previewStudentMatch(workspaceId: string, body: MatchPreviewRequest): Promise<MatchPreviewResponse> {
  return apiRequest<MatchPreviewResponse>("/students/match-preview", { method: "POST", workspaceId, body });
}

export function createStudent(workspaceId: string, body: CreateStudentRequest): Promise<CreateStudentResponse> {
  return apiRequest<CreateStudentResponse>("/students", { method: "POST", workspaceId, body });
}

export function updateStudent(workspaceId: string, studentId: string, body: UpdateStudentRequest): Promise<Student> {
  return apiRequest<Student>(`/students/${studentId}`, { method: "PATCH", workspaceId, body });
}

export function archiveStudent(workspaceId: string, studentId: string): Promise<Student> {
  return apiRequest<Student>(`/students/${studentId}/archive`, { method: "POST", workspaceId });
}

export function linkGuardian(workspaceId: string, studentId: string, body: LinkGuardianRequest): Promise<GuardianLink> {
  return apiRequest<GuardianLink>(`/students/${studentId}/guardians`, { method: "POST", workspaceId, body });
}

export function updateGuardian(workspaceId: string, studentId: string, guardianId: string, body: UpdateStudentGuardianRequest): Promise<GuardianLink> {
  return apiRequest<GuardianLink>(`/students/${studentId}/guardians/${guardianId}`, { method: "PATCH", workspaceId, body });
}

export function setPrimaryGuardian(workspaceId: string, studentId: string, guardianId: string): Promise<GuardianLink> {
  return apiRequest<GuardianLink>(`/students/${studentId}/guardians/${guardianId}/set-primary`, { method: "POST", workspaceId });
}

export function issueStudentQr(workspaceId: string, studentId: string): Promise<QrIssueResponse> {
  return apiRequest<QrIssueResponse>(`/students/${studentId}/qr/issue`, { method: "POST", workspaceId });
}

export function reissueStudentQr(workspaceId: string, studentId: string, body: QrReissueRequest): Promise<QrIssueResponse> {
  return apiRequest<QrIssueResponse>(`/students/${studentId}/qr/reissue`, { method: "POST", workspaceId, body });
}

export function resolveQr(workspaceId: string, body: QrResolveRequest): Promise<QrResolveResponse> {
  return apiRequest<QrResolveResponse>("/qr/resolve", { method: "POST", workspaceId, body });
}

// --- Enrollments -----------------------------------------------------------

export function previewEnrollment(workspaceId: string, groupMonthId: string, body: EnrollmentPreviewRequest): Promise<EnrollmentPreviewResponse> {
  return apiRequest<EnrollmentPreviewResponse>(`/group-months/${groupMonthId}/enrollments/preview`, { method: "POST", workspaceId, body });
}

export function createEnrollment(workspaceId: string, groupMonthId: string, body: EnrollmentCreateRequest): Promise<EnrollmentCreateResponse> {
  return apiRequest<EnrollmentCreateResponse>(`/group-months/${groupMonthId}/enrollments`, { method: "POST", workspaceId, body });
}

/** Bulk-enroll several existing students into one GroupMonth (single call, reuses the per-student create/reactivate logic server-side). */
export function batchEnrollStudents(workspaceId: string, groupMonthId: string, body: EnrollmentBatchRequest): Promise<EnrollmentBatchResponse> {
  return apiRequest<EnrollmentBatchResponse>(`/group-months/${groupMonthId}/enrollments/batch`, { method: "POST", workspaceId, body });
}

export function withdrawEnrollment(workspaceId: string, enrollmentId: string, body: EnrollmentWithdrawRequest): Promise<EnrollmentWithdrawResponse> {
  return apiRequest<EnrollmentWithdrawResponse>(`/enrollments/${enrollmentId}/withdraw`, { method: "POST", workspaceId, body });
}

export function previewEnrollmentTransfer(workspaceId: string, enrollmentId: string, body: EnrollmentTransferPreviewRequest): Promise<EnrollmentTransferPreviewResponse> {
  return apiRequest<EnrollmentTransferPreviewResponse>(`/enrollments/${enrollmentId}/transfer-preview`, { method: "POST", workspaceId, body });
}

export function transferEnrollment(workspaceId: string, enrollmentId: string, body: EnrollmentTransferRequest): Promise<EnrollmentTransferResponse> {
  return apiRequest<EnrollmentTransferResponse>(`/enrollments/${enrollmentId}/transfer`, { method: "POST", workspaceId, body });
}
