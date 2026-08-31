import { Inject, Injectable } from "@nestjs/common";
import type {
  CreateReportExportRequest,
  CreateReportExportResponse,
  GetExportResponse,
  GroupReportResponse,
  MonthlyTeacherReportResponse,
  ReportExportFormat,
  StudentReportResponse,
} from "@academic-precision/contracts";
import { ResourceNotFoundException, ValidationApiException } from "../../common/exceptions/api.exception";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import type { WorkspaceContext } from "../../team/api/guards/permission.guard";
import { PermissionResolverService } from "../../team/application/permission-resolver.service";
import { REPORTS_REPOSITORY, type ReportsRepositoryPort } from "./ports/reports-repository.port";
import { toCsv } from "./csv";
import {
  arabicMonth,
  buildGroupDocument,
  buildMonthlyDocument,
  buildStudentDocument,
  type ReportDocument,
  type ReportDocumentMeta,
} from "./report-document";
import { renderReportXlsx } from "./xlsx.renderer";
import { renderReportPdf } from "./pdf.renderer";

const EXPORT_TTL_MS = 15 * 60 * 1000; // short-lived — see schema/reports.ts's own doc comment.
const VIEW_PERMISSION = "reports.view";
const EXPORT_PERMISSION = "reports.export";
const FINANCE_PERMISSION = "finance.overview";

/** Filesystem-safe name: keep Arabic letters/digits/space/dash, collapse the rest. */
function sanitizeFilename(stem: string): string {
  return stem.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "-").slice(0, 120) || "تقرير";
}

const FORMAT_META: Record<ReportExportFormat, { ext: string; contentType: string }> = {
  CSV: { ext: "csv", contentType: "text/csv; charset=utf-8" },
  XLSX: { ext: "xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  PDF: { ext: "pdf", contentType: "application/pdf" },
};

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
    const [result, canFinance] = await Promise.all([
      this.repository.getStudentReport(workspaceContext.workspaceId, studentId),
      this.canViewFinance(authUser, workspaceContext),
    ]);
    if (!result) throw new ResourceNotFoundException();
    return this.toStudentReportDto(result, canFinance);
  }

  async getGroupReport(authUser: VerifiedSupabaseToken, workspaceContext: WorkspaceContext, groupId: string): Promise<GroupReportResponse> {
    await this.assertGroupInScope(authUser, workspaceContext, groupId);
    const [result, canFinance] = await Promise.all([
      this.repository.getGroupReport(workspaceContext.workspaceId, groupId),
      this.canViewFinance(authUser, workspaceContext),
    ]);
    if (!result) throw new ResourceNotFoundException();
    return this.toGroupReportDto(result, canFinance);
  }

  async getMonthlyTeacherReport(authUser: VerifiedSupabaseToken, workspaceContext: WorkspaceContext, monthId: string): Promise<MonthlyTeacherReportResponse> {
    const visibleGroupIds = await this.resolveVisibleGroupIds(authUser, workspaceContext, VIEW_PERMISSION);
    const [result, canFinance] = await Promise.all([
      this.repository.getMonthlyTeacherReport(workspaceContext.workspaceId, monthId, visibleGroupIds),
      this.canViewFinance(authUser, workspaceContext),
    ]);
    if (!result) throw new ResourceNotFoundException();
    return this.toMonthlyReportDto(result, canFinance);
  }

  /** True iff the caller holds `finance.overview` — the ONLY gate for any money figure in a report/export (backend-enforced, never UI-hidden). */
  private async canViewFinance(authUser: VerifiedSupabaseToken, workspaceContext: WorkspaceContext): Promise<boolean> {
    const grant = await this.permissionResolver.hasPermission(workspaceContext.workspaceId, authUser.id, FINANCE_PERMISSION);
    return !!grant;
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
      // Format travels in params (no schema column needed) so download picks the renderer.
      params: { ...params, format: body.format },
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

  /**
   * Returns the freshly-recomputed export in the requested format (CSV / XLSX /
   * PDF) — the controller sets the content-type and returns the body. Re-checks
   * Permission/Entitlement/Group-Scope AND finance visibility at THIS moment
   * (correction #4): a caller who lost access/finance since creation is blocked
   * or gets a redacted document. XLSX/PDF reuse the SAME redacted DTO the
   * preview shows (single source of truth), via the shared ReportDocument.
   */
  async downloadExport(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    exportId: string,
  ): Promise<{ filename: string; contentType: string; body: string | Buffer }> {
    const row = await this.repository.findExport(workspaceContext.workspaceId, exportId);
    if (!row) throw new ResourceNotFoundException();
    if (row.expiresAt.getTime() < Date.now()) {
      throw new ValidationApiException({ _root: ["انتهت صلاحية رابط التنزيل — أعد إنشاء التصدير."] });
    }
    await this.assertExportInScope(authUser, workspaceContext, row);

    const format = (typeof row.params.format === "string" ? row.params.format : "CSV") as ReportExportFormat;
    const [canFinance, workspaceName] = await Promise.all([
      this.canViewFinance(authUser, workspaceContext),
      this.repository.getWorkspaceName(workspaceContext.workspaceId).then((n) => n ?? "راصد"),
    ]);
    const exportedAt = new Date();

    if (row.type === "STUDENT") {
      const result = await this.repository.getStudentReport(workspaceContext.workspaceId, row.params.studentId as string);
      if (!result) throw new ResourceNotFoundException();
      const dto = this.toStudentReportDto(result, canFinance);
      const meta: ReportDocumentMeta = { workspaceName, period: dto.currentMonth ? arabicMonth(dto.currentMonth.year, dto.currentMonth.month) : "الحالية", exportedAt };
      return this.renderByFormat(buildStudentDocument(dto, meta), format, () => this.studentObligationsToCsv(dto.obligationsByMonth));
    }
    if (row.type === "GROUP") {
      const result = await this.repository.getGroupReport(workspaceContext.workspaceId, row.params.groupId as string);
      if (!result) throw new ResourceNotFoundException();
      const dto = this.toGroupReportDto(result, canFinance);
      const meta: ReportDocumentMeta = { workspaceName, period: dto.currentMonth ? arabicMonth(dto.currentMonth.year, dto.currentMonth.month) : "الحالية", exportedAt };
      return this.renderByFormat(buildGroupDocument(dto, meta), format, () => this.groupRosterToCsv(dto.roster));
    }
    const visibleGroupIds = await this.resolveVisibleGroupIds(authUser, workspaceContext, EXPORT_PERMISSION);
    const result = await this.repository.getMonthlyTeacherReport(workspaceContext.workspaceId, row.params.monthId as string, visibleGroupIds);
    if (!result) throw new ResourceNotFoundException();
    const dto = this.toMonthlyReportDto(result, canFinance);
    const meta: ReportDocumentMeta = { workspaceName, period: arabicMonth(dto.month.year, dto.month.month), exportedAt };
    return this.renderByFormat(buildMonthlyDocument(dto, meta), format, () => this.monthlyGroupsToCsv(dto.groups));
  }

  private async renderByFormat(
    doc: ReportDocument,
    format: ReportExportFormat,
    csvFn: () => string,
  ): Promise<{ filename: string; contentType: string; body: string | Buffer }> {
    const fm = FORMAT_META[format];
    const filename = `راصد-${sanitizeFilename(doc.fileStem)}.${fm.ext}`;
    if (format === "XLSX") return { filename, contentType: fm.contentType, body: await renderReportXlsx(doc) };
    if (format === "PDF") return { filename, contentType: fm.contentType, body: await renderReportPdf(doc) };
    return { filename, contentType: fm.contentType, body: csvFn() };
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

  private toStudentReportDto(r: NonNullable<Awaited<ReturnType<ReportsRepositoryPort["getStudentReport"]>>>, canFinance: boolean): StudentReportResponse {
    return {
      student: r.student,
      currentMonth: r.currentMonth,
      sessions: r.sessions,
      activeAttentionCase: r.activeAttentionCase ? { ...r.activeAttentionCase, openedAt: r.activeAttentionCase.openedAt.toISOString() } : null,
      // Finance redaction: no finance.overview → no money rows at all.
      obligationsByMonth: canFinance ? r.obligationsByMonth : [],
    };
  }

  private toGroupReportDto(r: NonNullable<Awaited<ReturnType<ReportsRepositoryPort["getGroupReport"]>>>, canFinance: boolean): GroupReportResponse {
    return { ...r, collection: canFinance ? r.collection : null };
  }

  private toMonthlyReportDto(r: NonNullable<Awaited<ReturnType<ReportsRepositoryPort["getMonthlyTeacherReport"]>>>, canFinance: boolean): MonthlyTeacherReportResponse {
    return {
      ...r,
      totals: { ...r.totals, collection: canFinance ? r.totals.collection : null, overdueCount: canFinance ? r.totals.overdueCount : null },
    };
  }

  private studentObligationsToCsv(obligations: StudentReportResponse["obligationsByMonth"]): string {
    return toCsv(
      [
        { key: "monthLabel", label: "الشهر" },
        { key: "groupName", label: "المجموعة" },
        { key: "netDueMinor", label: "المطلوب (قرش)" },
        { key: "amountPaidMinor", label: "المدفوع (قرش)" },
        { key: "remainingMinor", label: "المتبقي (قرش)" },
        { key: "status", label: "الحالة" },
      ],
      obligations.map((o) => ({ ...o, monthLabel: `${o.year}-${String(o.month).padStart(2, "0")}` })),
    );
  }

  private groupRosterToCsv(roster: GroupReportResponse["roster"]): string {
    return toCsv(
      [
        { key: "studentName", label: "الطالب" },
        { key: "status", label: "حالة القيد" },
      ],
      roster,
    );
  }

  private monthlyGroupsToCsv(groups: MonthlyTeacherReportResponse["groups"]): string {
    return toCsv(
      [
        { key: "groupName", label: "المجموعة" },
        { key: "studentsCount", label: "عدد الطلاب" },
        { key: "sessionsCount", label: "عدد الحصص" },
      ],
      groups,
    );
  }
}
