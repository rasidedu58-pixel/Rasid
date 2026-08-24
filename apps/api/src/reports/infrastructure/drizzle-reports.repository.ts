import { Injectable } from "@nestjs/common";
import {
  createExport,
  findExport,
  getGroupReport,
  getMonthlyTeacherReport,
  getStudentReport,
  listGroupIdsForStudent,
  withRuntimeContext,
} from "@academic-precision/database";
import { getContext } from "@academic-precision/observability";
import type { CreateExportInput, ExportRow, ReportsRepositoryPort } from "../application/ports/reports-repository.port";

@Injectable()
export class DrizzleReportsRepository implements ReportsRepositoryPort {
  private runtimeCtx(workspaceId?: string) {
    const ctx = getContext();
    return { userId: ctx?.userId, workspaceId: workspaceId ?? (ctx?.workspaceId as string | undefined) };
  }

  getStudentReport(workspaceId: string, studentId: string) {
    return withRuntimeContext(this.runtimeCtx(workspaceId), (db) => getStudentReport(db, workspaceId, studentId));
  }

  getGroupReport(workspaceId: string, groupId: string) {
    return withRuntimeContext(this.runtimeCtx(workspaceId), (db) => getGroupReport(db, workspaceId, groupId));
  }

  getMonthlyTeacherReport(workspaceId: string, monthId: string, visibleGroupIds: "ALL" | string[]) {
    return withRuntimeContext(this.runtimeCtx(workspaceId), (db) => getMonthlyTeacherReport(db, workspaceId, monthId, visibleGroupIds));
  }

  listGroupIdsForStudent(studentId: string): Promise<string[]> {
    return withRuntimeContext(this.runtimeCtx(), (db) => listGroupIdsForStudent(db, studentId));
  }

  async createExport(input: CreateExportInput): Promise<ExportRow> {
    const row = await withRuntimeContext(this.runtimeCtx(input.workspaceId), (db) => createExport(db, input));
    return row as ExportRow;
  }

  async findExport(workspaceId: string, exportId: string): Promise<ExportRow | undefined> {
    const row = await withRuntimeContext(this.runtimeCtx(workspaceId), (db) => findExport(db, workspaceId, exportId));
    return row as ExportRow | undefined;
  }
}
