import { randomUUID } from "node:crypto";
import type { GroupReportResult, MonthlyTeacherReportResult, StudentReportResult } from "@academic-precision/database";
import type { CreateExportInput, ExportRow, ReportsRepositoryPort } from "../ports/reports-repository.port";

export class InMemoryReportsRepository implements ReportsRepositoryPort {
  readonly studentReports = new Map<string, StudentReportResult>(); // key: `${workspaceId}:${studentId}`
  readonly groupReports = new Map<string, GroupReportResult>();
  readonly monthlyReports = new Map<string, MonthlyTeacherReportResult>();
  readonly groupIdsByStudentId = new Map<string, string[]>();
  readonly exportsById = new Map<string, ExportRow>();

  seedStudentReport(workspaceId: string, studentId: string, result: StudentReportResult): void {
    this.studentReports.set(`${workspaceId}:${studentId}`, result);
  }

  seedGroupReport(workspaceId: string, groupId: string, result: GroupReportResult): void {
    this.groupReports.set(`${workspaceId}:${groupId}`, result);
  }

  seedMonthlyReport(workspaceId: string, monthId: string, visibleGroupIds: "ALL" | string[], result: MonthlyTeacherReportResult): void {
    this.monthlyReports.set(`${workspaceId}:${monthId}:${Array.isArray(visibleGroupIds) ? visibleGroupIds.slice().sort().join(",") : "ALL"}`, result);
  }

  seedStudentGroups(studentId: string, groupIds: string[]): void {
    this.groupIdsByStudentId.set(studentId, groupIds);
  }

  async getStudentReport(workspaceId: string, studentId: string): Promise<StudentReportResult | undefined> {
    return this.studentReports.get(`${workspaceId}:${studentId}`);
  }

  async getGroupReport(workspaceId: string, groupId: string): Promise<GroupReportResult | undefined> {
    return this.groupReports.get(`${workspaceId}:${groupId}`);
  }

  async getMonthlyTeacherReport(workspaceId: string, monthId: string, visibleGroupIds: "ALL" | string[]): Promise<MonthlyTeacherReportResult | undefined> {
    const key = `${workspaceId}:${monthId}:${Array.isArray(visibleGroupIds) ? visibleGroupIds.slice().sort().join(",") : "ALL"}`;
    return this.monthlyReports.get(key);
  }

  async listGroupIdsForStudent(studentId: string): Promise<string[]> {
    return this.groupIdsByStudentId.get(studentId) ?? [];
  }

  async createExport(input: CreateExportInput): Promise<ExportRow> {
    const row: ExportRow = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      requestedByMembershipId: input.requestedByMembershipId,
      type: input.type,
      format: "CSV",
      params: input.params,
      status: "READY",
      errorMessage: null,
      createdAt: new Date(),
      expiresAt: input.expiresAt,
    };
    this.exportsById.set(row.id, row);
    return row;
  }

  async findExport(workspaceId: string, exportId: string): Promise<ExportRow | undefined> {
    const row = this.exportsById.get(exportId);
    return row && row.workspaceId === workspaceId ? row : undefined;
  }
}
