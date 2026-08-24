"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Badge, Card, ErrorState, LoadingRegion, SectionCard, StatCard, formatMoney, formatMonthLabel } from "@academic-precision/ui";
import { PageHeader } from "../../../../components/shell/page-header";
import { ExportCsvButton } from "../../../../components/reports/export-csv-button";
import { useWorkspace } from "../../../../lib/workspace-provider";
import { qk } from "../../../../lib/query-keys";
import { fetchGroup } from "../../../../lib/api/scheduling";
import { fetchGroupReport } from "../../../../lib/api/reports";

/**
 * Group Detail — deliberately built on the Group Report endpoint (Phase
 * 9/10, already aggregates roster + attendance/homework + collection for
 * the CURRENT month in ONE call) rather than re-assembling the same view
 * from 5 separate calls (§23's own "don't re-fracture an optimized report
 * into many calls" rule applies equally here, not just the Reports page).
 * `Group` itself (permanent entity: name/subject/grade/status) is fetched
 * separately since the report only echoes a subset of it.
 */
export default function GroupDetailPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const { workspaceId } = useWorkspace();

  const groupQuery = useQuery({
    queryKey: workspaceId ? qk.groups.detail(workspaceId, groupId) : ["group", "none"],
    queryFn: () => fetchGroup(workspaceId!, groupId),
    enabled: !!workspaceId,
  });
  const reportQuery = useQuery({
    queryKey: workspaceId ? qk.reports.group(workspaceId, groupId) : ["group-report", "none"],
    queryFn: () => fetchGroupReport(workspaceId!, groupId),
    enabled: !!workspaceId,
  });

  if (groupQuery.isLoading || reportQuery.isLoading) return <LoadingRegion className="min-h-[60vh]" />;
  if (groupQuery.isError || reportQuery.isError || !groupQuery.data || !reportQuery.data) {
    return <ErrorState onRetry={() => { groupQuery.refetch(); reportQuery.refetch(); }} />;
  }

  const group = groupQuery.data;
  const report = reportQuery.data;

  return (
    <>
      <PageHeader
        title={group.name}
        description={[group.subject, group.grade].filter(Boolean).join(" · ") || undefined}
        actions={
          <div className="flex items-center gap-2">
            <ExportCsvButton type="GROUP" groupId={groupId} filename={`${group.name}.csv`} />
            <Badge tone={group.status === "ACTIVE" ? "success" : "neutral"}>{group.status === "ACTIVE" ? "نشطة" : "مؤرشفة"}</Badge>
          </div>
        }
      />

      {!report.currentMonth ? (
        <Card className="p-6 text-center text-sm text-text-secondary">لا يوجد شهر تشغيلي حالي لهذه المجموعة.</Card>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="الشهر الحالي" value={formatMonthLabel(report.currentMonth.year, report.currentMonth.month)} />
            <StatCard label="الطلاب" value={String(report.roster.length)} />
            <StatCard label="الحصص" value={`${report.sessions.completed}/${report.sessions.total}`} />
            <StatCard label="سجلات ناقصة" value={String(report.missingRecordsCount)} tone={report.missingRecordsCount > 0 ? "warning" : undefined} />
          </div>

          <SectionCard title="التحصيل المالي هذا الشهر">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatCard label="الإجمالي المستحق" value={formatMoney(report.collection.totalDueMinor)} />
              <StatCard label="المحصّل" value={formatMoney(report.collection.totalPaidMinor)} />
              <StatCard label="المتبقي" value={formatMoney(report.collection.totalRemainingMinor)} />
              <StatCard label="متأخرات" value={String(report.collection.overdueCount)} tone={report.collection.overdueCount > 0 ? "danger" : undefined} />
            </div>
          </SectionCard>

          <SectionCard title="الطلاب المسجّلون">
            {report.roster.length === 0 ? (
              <p className="text-sm text-text-secondary">لا يوجد طلاب مسجّلون هذا الشهر.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {report.roster.map((r) => (
                  <li key={r.enrollmentId} className="flex items-center justify-between py-2">
                    <Link href={`/students/${r.studentId}`} className="text-sm text-text-primary hover:text-brand hover:underline">
                      {r.studentName}
                    </Link>
                    <Badge tone="neutral">{r.status === "ACTIVE" ? "نشط" : r.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="الحصص" action={<Link href="/sessions" className="text-sm text-brand hover:underline">عرض كل الحصص</Link>}>
            <p className="text-sm text-text-secondary">
              {report.attendance.present} حضور · {report.attendance.absent} غياب · {report.attendance.late} تأخير
            </p>
          </SectionCard>
        </div>
      )}
    </>
  );
}
