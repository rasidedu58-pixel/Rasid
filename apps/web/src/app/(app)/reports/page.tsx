"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileBarChart } from "lucide-react";
import { Card, ErrorState, LoadingRegion, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SectionCard, StatCard, formatMoney, formatMonthLabel } from "@academic-precision/ui";
import { PageHeader } from "../../../components/shell/page-header";
import { useWorkspace } from "../../../lib/workspace-provider";
import { qk } from "../../../lib/query-keys";
import { fetchMonths } from "../../../lib/api/scheduling";
import { fetchMonthlyReport } from "../../../lib/api/reports";
import { ExportCsvButton } from "../../../components/reports/export-csv-button";

/**
 * Reports (§23): V1 has Student/Group reports (embedded in their own
 * profile/detail pages — the "report" IS the profile, not a duplicate
 * screen) plus this dedicated Monthly Teacher Report viewer, which has no
 * other natural home page. Respects SELECTED_GROUPS visibility server-side
 * — this page never recomputes or reveals a hidden group's totals.
 */
export default function ReportsPage() {
  const { workspaceId } = useWorkspace();
  const [monthId, setMonthId] = useState<string | undefined>();

  const monthsQuery = useQuery({
    queryKey: workspaceId ? qk.months.list(workspaceId) : ["months", "none"],
    queryFn: () => fetchMonths(workspaceId!),
    enabled: !!workspaceId,
  });

  const reportQuery = useQuery({
    queryKey: workspaceId && monthId ? qk.reports.monthly(workspaceId, monthId) : ["monthly-report", "none"],
    queryFn: () => fetchMonthlyReport(workspaceId!, monthId!),
    enabled: !!workspaceId && !!monthId,
  });

  const months = monthsQuery.data?.months ?? [];
  const effectiveMonthId = monthId ?? months.find((m) => m.status === "CURRENT")?.id;

  return (
    <>
      <PageHeader
        title="التقارير"
        actions={effectiveMonthId ? <ExportCsvButton type="MONTHLY_TEACHER" monthId={effectiveMonthId} filename="monthly-report.csv" /> : undefined}
      />

      <div className="mb-4 max-w-xs">
        <Select value={effectiveMonthId} onValueChange={setMonthId}>
          <SelectTrigger>
            <SelectValue placeholder="اختر الشهر" />
          </SelectTrigger>
          <SelectContent>
            {months.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {formatMonthLabel(m.year, m.month)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!effectiveMonthId ? (
        <Card className="p-6 text-center text-sm text-text-secondary">اختر شهرًا لعرض تقريره.</Card>
      ) : reportQuery.isLoading ? (
        <LoadingRegion />
      ) : reportQuery.isError || !reportQuery.data ? (
        <ErrorState onRetry={() => reportQuery.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="الطلاب" value={String(reportQuery.data.totals.studentsCount)} />
            <StatCard label="الحصص" value={String(reportQuery.data.totals.sessionsCount)} />
            <StatCard label="المتبقي" value={formatMoney(reportQuery.data.totals.collection.totalRemainingMinor)} />
            <StatCard label="متأخرات" value={String(reportQuery.data.totals.overdueCount)} tone={reportQuery.data.totals.overdueCount > 0 ? "danger" : undefined} />
          </div>

          <SectionCard title="المجموعات">
            {reportQuery.data.groups.length === 0 ? (
              <p className="text-sm text-text-secondary">لا توجد مجموعات ضمن نطاق رؤيتك لهذا الشهر.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {reportQuery.data.groups.map((g) => (
                  <li key={g.groupId} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-text-primary">{g.groupName}</span>
                    <span className="text-text-secondary tabular-nums">
                      {g.studentsCount} طالب · {g.sessionsCount} حصة
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="متابعة نشطة">
            <p className="text-sm text-text-secondary">
              {reportQuery.data.totals.openAttentionCount} حالة متابعة مفتوحة · {reportQuery.data.totals.openFollowupsCount} متابعة مجدولة
            </p>
          </SectionCard>
        </div>
      )}

      {!monthsQuery.isLoading && months.length === 0 ? (
        <Card className="mt-4 flex flex-col items-center gap-2 p-6 text-center">
          <FileBarChart className="h-8 w-8 text-text-tertiary" aria-hidden />
          <p className="text-sm text-text-secondary">لا يوجد شهر تشغيلي بعد.</p>
        </Card>
      ) : null}
    </>
  );
}
