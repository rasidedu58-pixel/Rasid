import { Inject, Injectable } from "@nestjs/common";
import type {
  CreateReportExportRequest,
  CreateReportExportResponse,
  GetExportResponse,
  GroupReportResponse,
  MonthlyTeacherReportResponse,
  StudentReportResponse,
} from "@academic-precision/contracts";
import { ResourceNotFoundException, ValidationApiException } from "../../common/exceptions/api.exception";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import type { WorkspaceContext } from "../../team/api/guards/permission.guard";
import { PermissionResolverService } from "../../team/application/permission-resolver.service";
import { REPORTS_REPOSITORY, type ReportsRepositoryPort } from "./ports/reports-repository.port";
import { toCsv } from "./csv";

const EXPORT_TTL_MS = 15 * 60 * 1000; // short-lived — see schema/reports.ts's own doc comment.
const VIEW_PERMISSION = "reports.view";
const EXPORT_PERMISSION = "reports.export";

/**
 * Application service for Phase 9 Reports endpoints. Controllers stay thin;
 * all authorization/business rules live here, mirroring the Phase 1-8
 * convention.
 *
 * Phase 9 Closure correction #1: Monthly Teacher Report never requires
 * ALL_GROUPS — a SELECTED_GROUPS caller gets the SAME report, computed ONLY
 * from their visible groups (see `resolveVisibleGroupIds`).
 *
 * Phase 9 Closure correction #4: exports store METADATA only. `download`
 * re-runs the exact same report query + re-checks Permission/Entitlement/
 * Group-Scope at that moment — a caller who lost access after creating the
 * export is correctly blocked at download time, not just at creation time.
 */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(REPORTS_REPOSITORY) private readonly repository: ReportsRepositoryPort,
    private readonly permissionResolver: PermissionResolverService,
  ) {}

  // ---------------------------------------------------------------------
  // Reads — reports.view only, NO Entitlement gate (Historical/Core read;
  // stays available for Expired/Payment Failed workspaces).
  // ---------------------------------------------------------------------

  async getStudentReport(authUser: VerifiedSupabaseToken, workspaceContext: WorkspaceContext, studentId: string): Promise<StudentReportResponse> {
    await this.assertStudentInScope(authUser, workspaceContext, studentId);
    const result = await this.repository.getStudentReport(workspaceContext.workspaceId, studentId);
    if (!result) throw new ResourceNotFoundException();
    return this.toStudentReportDto(result);
  }

  async getGroupReport(authUser: VerifiedSupabaseToken, workspaceContext: WorkspaceContext, groupId: string): Promise<GroupReportResponse> {
    await this.assertGroupInScope(authUser, workspaceContext, groupId);
    const result = await this.repository.getGroupReport(workspaceContext.workspaceId, groupId);
    if (!result) throw new ResourceNotFoundException();
    return this.toGroupReportDto(result);
  }

  async getMonthlyTeacherReport(authUser: VerifiedSupabaseToken, workspaceContext: WorkspaceContext, monthId: string): Promise<MonthlyTeacherReportResponse> {
    const visibleGroupIds = await this.resolveVisibleGroupIds(authUser, workspaceContext, VIEW_PERMISSION);
    const result = await this.repository.getMonthlyTeacherReport(workspaceContext.workspaceId, monthId, visibleGroupIds);
    if (!result) throw new ResourceNotFoundException();
    return this.toMonthlyReportDto(result);
  }

  // ---------------------------------------------------------------------
  // Export — reports.export + REPORT_EXPORT Entitlement (the latter is
  // enforced by `EntitlementGuard`/`@RequireEntitlement` at the controller
  // level, per the established Phase 8 convention — never re-implemented
  // here).
  // ---------------------------------------------------------------------

  async createExport(authUser: VerifiedSupabaseToken, workspaceContext: WorkspaceContext, body: CreateReportExportRequest): Promise<CreateReportExportResponse> {
    const params = await this.validateAndScopeExportParams(authUser, workspaceContext, body);
    const row = await this.repository.createExport({
      workspaceId: workspaceContext.workspaceId,
      requestedByMembershipId: workspaceContext.membership.id,
      type: body.type,
      params,
      expiresAt: new Date(Date.now() + EXPORT_TTL_MS),
    });
    return { exportId: row.id, status: row.status };
  }

  async getExportStatus(authUser: VerifiedSupabaseToken, workspaceContext: WorkspaceContext, exportId: string): Promise<GetExportResponse> {
    const row = await this.repository.findExport(workspaceContext.workspaceId, exportId);
    if (!row) throw new ResourceNotFoundException();
    // Re-validate scope even for the STATUS check (not just download) — a
    // status response with a live downloadUrl for data the caller can no
    // longer reach would itself be a leak of "this export still exists".
    await this.assertExportInScope(authUser, workspaceContext, row);
    const expired = row.expiresAt.getTime() < Date.now();
    return {
      status: expired ? "FAILED" : row.status,
      downloadUrl: expired ? null : `/api/v1/exports/${row.id}/download`,
      expiresAt: row.expiresAt.toISOString(),
      errorMessage: expired ? "انتهت صلاحية رابط التنزيل — أعد إنشاء التصدير." : row.errorMessage,
    };
  }

  /** Returns the freshly-recomputed CSV text — the controller streams it. Re-checks Permission/Entitlement/Group-Scope at THIS exact moment (correction #4). */
  async downloadExport(authUser: VerifiedSupabaseToken, workspaceContext: WorkspaceContext, exportId: string): Promise<{ filename: string; csv: string }> {
    const row = await this.repository.findExport(workspaceContext.workspaceId, exportId);
    if (!row) throw new ResourceNotFoundException();
    if (row.expiresAt.getTime() < Date.now()) {
      throw new ValidationApiException({ _root: ["انتهت صلاحية رابط التنزيل — أعد إنشاء التصدير."] });
    }
    await this.assertExportInScope(authUser, workspaceContext, row);

    if (row.type === "STUDENT") {
      const studentId = row.params.studentId as string;
      const result = await this.repository.getStudentReport(workspaceContext.workspaceId, studentId);
      if (!result) throw new ResourceNotFoundException();
      return { filename: `student-report-${result.student.studentCode}.csv`, csv: this.studentReportToCsv(result) };
    }
    if (row.type === "GROUP") {
      const groupId = row.params.groupId as string;
      const result = await this.repository.getGroupReport(workspaceContext.workspaceId, groupId);
      if (!result) throw new ResourceNotFoundException();
      return { filename: `group-report-${result.group.name}.csv`, csv: this.groupReportToCsv(result) };
    }
    const monthId = row.params.monthId as string;
    const visibleGroupIds = await this.resolveVisibleGroupIds(authUser, workspaceContext, EXPORT_PERMISSION);
    const result = await this.repository.getMonthlyTeacherReport(workspaceContext.workspaceId, monthId, visibleGroupIds);
    if (!result) throw new ResourceNotFoundException();
    return { filename: `monthly-report-${result.month.year}-${result.month.month}.csv`, csv: this.monthlyReportToCsv(result) };
  }

  // ---------------------------------------------------------------------
  // Scope helpers
  // ---------------------------------------------------------------------

  private async resolveVisibleGroupIds(authUser: VerifiedSupabaseToken, workspaceContext: WorkspaceContext, permission: "reports.view" | "reports.export"): Promise<"ALL" | string[]> {
    const grant = await this.permissionResolver.hasPermission(workspaceContext.workspaceId, authUser.id, permission);
    if (!grant || grant.scope === "ALL_GROUPS") return "ALL";
    return grant.groupIds ?? [];
  }

  private async assertGroupInScope(authUser: VerifiedSupabaseToken, workspaceContext: WorkspaceContext, groupId: string, permission: "reports.view" | "reports.export" = VIEW_PERMISSION): Promise<void> {
    const inScope = await this.permissionResolver.isGroupInScope(workspaceContext.workspaceId, authUser.id, permission, groupId);
    // Safe no-leak: an out-of-scope group id returns the SAME 404 as a
    // nonexistent one (never a distinguishable 403), matching the
    // established `students`/`groups` convention.
    if (!inScope) throw new ResourceNotFoundException();
  }

  private async assertStudentInScope(authUser: VerifiedSupabaseToken, workspaceContext: WorkspaceContext, studentId: string, permission: "reports.view" | "reports.export" = VIEW_PERMISSION): Promise<void> {
    const grant = await this.permissionResolver.hasPermission(workspaceContext.workspaceId, authUser.id, permission);
    if (!grant) throw new ResourceNotFoundException();
    if (grant.scope === "ALL_GROUPS") return;
    const studentGroupIds = await this.repository.listGroupIdsForStudent(studentId);
    const inScope = studentGroupIds.some((id) => (grant.groupIds ?? []).includes(id));
    if (!inScope) throw new ResourceNotFoundException();
  }

  private async validateAndScopeExportParams(authUser: VerifiedSupabaseToken, workspaceContext: WorkspaceContext, body: CreateReportExportRequest): Promise<Record<string, unknown>> {
    if (body.type === "STUDENT") {
      if (!body.studentId) throw new ValidationApiException({ studentId: ["مطلوب لتصدير تقرير طالب."] });
      await this.assertStudentInScope(authUser, workspaceContext, body.studentId, EXPORT_PERMISSION);
      return { studentId: body.studentId, filters: body.filters ?? {} };
    }
    if (body.type === "GROUP") {
      if (!body.groupId) throw new ValidationApiException({ groupId: ["مطلوب لتصدير تقرير مجموعة."] });
      await this.assertGroupInScope(authUser, workspaceContext, body.groupId, EXPORT_PERMISSION);
      return { groupId: body.groupId, filters: body.filters ?? {} };
    }
    if (!body.monthId) throw new ValidationApiException({ monthId: ["مطلوب لتصدير التقرير الشهري."] });
    return { monthId: body.monthId, filters: body.filters ?? {} };
  }

  private async assertExportInScope(authUser: VerifiedSupabaseToken, workspaceContext: WorkspaceContext, row: { type: "STUDENT" | "GROUP" | "MONTHLY_TEACHER"; params: Record<string, unknown> }): Promise<void> {
    if (row.type === "STUDENT") {
      await this.assertStudentInScope(authUser, workspaceContext, row.params.studentId as string, EXPORT_PERMISSION);
      return;
    }
    if (row.type === "GROUP") {
      await this.assertGroupInScope(authUser, workspaceContext, row.params.groupId as string, EXPORT_PERMISSION);
      return;
    }
    // MONTHLY_TEACHER: no single group to check — resolving visible group
    // ids again (and the report query itself filtering to them) is the
    // scope check; an ALL_GROUPS-turned-SELECTED_GROUPS caller since export
    // creation simply gets a narrower re-computed CSV, never a leak.
  }

  // ---------------------------------------------------------------------
  // DTO / CSV mapping
  // ---------------------------------------------------------------------

  private toStudentReportDto(r: NonNullable<Awaited<ReturnType<ReportsRepositoryPort["getStudentReport"]>>>): StudentReportResponse {
    return {
      student: r.student,
      currentMonth: r.currentMonth,
      sessions: r.sessions,
      activeAttentionCase: r.activeAttentionCase ? { ...r.activeAttentionCase, openedAt: r.activeAttentionCase.openedAt.toISOString() } : null,
      obligationsByMonth: r.obligationsByMonth,
    };
  }

  private toGroupReportDto(r: NonNullable<Awaited<ReturnType<ReportsRepositoryPort["getGroupReport"]>>>): GroupReportResponse {
    return r;
  }

  private toMonthlyReportDto(r: NonNullable<Awaited<ReturnType<ReportsRepositoryPort["getMonthlyTeacherReport"]>>>): MonthlyTeacherReportResponse {
    return r;
  }

  private studentReportToCsv(r: NonNullable<Awaited<ReturnType<ReportsRepositoryPort["getStudentReport"]>>>): string {
    return toCsv(
      [
        { key: "monthLabel", label: "الشهر" },
        { key: "groupName", label: "المجموعة" },
        { key: "netDueMinor", label: "المطلوب (قرش)" },
        { key: "amountPaidMinor", label: "المدفوع (قرش)" },
        { key: "remainingMinor", label: "المتبقي (قرش)" },
        { key: "status", label: "الحالة" },
      ],
      r.obligationsByMonth.map((o) => ({ ...o, monthLabel: `${o.year}-${String(o.month).padStart(2, "0")}` })),
    );
  }

  private groupReportToCsv(r: NonNullable<Awaited<ReturnType<ReportsRepositoryPort["getGroupReport"]>>>): string {
    return toCsv(
      [
        { key: "studentName", label: "الطالب" },
        { key: "status", label: "حالة القيد" },
      ],
      r.roster,
    );
  }

  private monthlyReportToCsv(r: NonNullable<Awaited<ReturnType<ReportsRepositoryPort["getMonthlyTeacherReport"]>>>): string {
    return toCsv(
      [
        { key: "groupName", label: "المجموعة" },
        { key: "studentsCount", label: "عدد الطلاب" },
        { key: "sessionsCount", label: "عدد الحصص" },
      ],
      r.groups,
    );
  }
}
