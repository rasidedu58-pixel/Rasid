import type { GroupReportResult, MonthlyTeacherReportResult, StudentReportResult } from "@academic-precision/database";

export interface ExportRow {
  id: string;
  workspaceId: string;
  requestedByMembershipId: string;
  type: "STUDENT" | "GROUP" | "MONTHLY_TEACHER";
  format: "CSV";
  params: Record<string, unknown>;
  status: "QUEUED" | "READY" | "FAILED";
  errorMessage: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface CreateExportInput {
  workspaceId: string;
  requestedByMembershipId: string;
  type: "STUDENT" | "GROUP" | "MONTHLY_TEACHER";
  params: Record<string, unknown>;
  expiresAt: Date;
}

/** Minimal, module-local port — mirrors `EntitlementRepositoryPort`'s own "narrower than the full domain, re-provided per consuming module" convention. */
export interface ReportsRepositoryPort {
  getStudentReport(workspaceId: string, studentId: string): Promise<StudentReportResult | undefined>;
  getGroupReport(workspaceId: string, groupId: string): Promise<GroupReportResult | undefined>;
  getMonthlyTeacherReport(workspaceId: string, monthId: string, visibleGroupIds: "ALL" | string[]): Promise<MonthlyTeacherReportResult | undefined>;
  /** Every Group a Student currently or previously belonged to (via any Enrollment) — used for the Group-Scope check on Student Report/Export, mirroring `StudentsService`'s own `isStudentInScope`. */
  listGroupIdsForStudent(studentId: string): Promise<string[]>;
  createExport(input: CreateExportInput): Promise<ExportRow>;
  findExport(workspaceId: string, exportId: string): Promise<ExportRow | undefined>;
}

export const REPORTS_REPOSITORY = Symbol("REPORTS_REPOSITORY");
