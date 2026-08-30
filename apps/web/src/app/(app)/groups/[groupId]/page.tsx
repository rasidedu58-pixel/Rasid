"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingRegion, MetricCell, MetricStrip, SectionCard, StatusDot, formatMoney, formatMonthLabel } from "@academic-precision/ui";
import { UserPlus } from "lucide-react";
import { PageHeader } from "../../../../components/shell/page-header";
import { ExportCsvButton } from "../../../../components/reports/export-csv-button";
import { AddStudentsToGroupSheet } from "../../../../components/enrollment/add-students-to-group-sheet";
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
  const { workspaceId, canWrite, hasPermission } = useWorkspace();
  const [addOpen, setAddOpen] = useState(false);
  const canManage = canWrite("CORE_OPERATIONS") && hasPermission("students.edit");

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
        eyebrow="المجموعة"
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
        <div className="flex flex-col gap-6">
          <MetricStrip>
            <MetricCell label="الشهر الحالي" value={formatMonthLabel(report.currentMonth.year, report.currentMonth.month)} />
            <MetricCell label="الطلاب" value={report.roster.length} />
            <MetricCell label="الحصص" value={`${report.sessions.completed}/${report.sessions.total}`} sub="مكتملة" />
            <MetricCell label="سجلات ناقصة" value={report.missingRecordsCount} tone={report.missingRecordsCount > 0 ? "warning" : "default"} />
          </MetricStrip>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-text-secondary">التحصيل المالي هذا الشهر</h2>
            <MetricStrip>
              <MetricCell label="الإجمالي المستحق" value={formatMoney(report.collection.totalDueMinor)} />
              <MetricCell label="المحصّل" value={formatMoney(report.collection.totalPaidMinor)} tone="success" />
              <MetricCell label="المتبقّي" value={formatMoney(report.collection.totalRemainingMinor)} tone={report.collection.totalRemainingMinor > 0 ? "danger" : "default"} />
              <MetricCell label="متأخرات" value={report.collection.overdueCount} tone={report.collection.overdueCount > 0 ? "danger" : "default"} />
            </MetricStrip>
          </section>

          <SectionCard
            title="الطلاب المسجّلون"
            action={canManage ? (
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <UserPlus className="h-4 w-4" aria-hidden />
                إضافة طلاب
              </Button>
            ) : undefined}
          >
            {report.roster.length === 0 ? (
              <EmptyState
                icon={<UserPlus className="h-8 w-8 text-text-tertiary" aria-hidden />}
                title="لا يوجد طلاب في هذه المجموعة بعد."
                description="أضف طلابًا جددًا أو سجّل طلابًا موجودين لبدء التشغيل."
                action={canManage ? <Button size="sm" onClick={() => setAddOpen(true)}><UserPlus className="h-4 w-4" aria-hidden />إضافة طلاب</Button> : undefined}
              />
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {report.roster.map((r) => (
                  <li key={r.enrollmentId} className="flex items-center justify-between py-2.5">
                    <Link href={`/students/${r.studentId}`} className="text-sm font-medium text-text-primary hover:text-brand">
                      {r.studentName}
                    </Link>
                    <StatusDot tone={r.status === "ACTIVE" ? "success" : "neutral"} label={r.status === "ACTIVE" ? "نشط" : r.status} />
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

      <AddStudentsToGroupSheet group={{ id: groupId, name: group.name }} open={addOpen} onOpenChange={setAddOpen} />
    </>
  );
}
