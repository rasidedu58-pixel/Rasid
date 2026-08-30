"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Badge, ErrorState, LoadingRegion, MetricCell, MetricStrip, Tabs, TabsContent, TabsList, TabsTrigger, formatMoney } from "@academic-precision/ui";
import { PageHeader } from "../../../../components/shell/page-header";
import { ExportCsvButton } from "../../../../components/reports/export-csv-button";
import { useWorkspace } from "../../../../lib/workspace-provider";
import { qk } from "../../../../lib/query-keys";
import { fetchStudentDetail } from "../../../../lib/api/students";
import { fetchStudentReport } from "../../../../lib/api/reports";
import { OverviewTab } from "./overview-tab";
import { GuardiansTab } from "./guardians-tab";
import { FinanceTab } from "./finance-tab";
import { EnrollmentsTab } from "./enrollments-tab";

/**
 * Student Profile — the strongest single screen in the product (§13).
 * `Student` (permanent entity + guardians) and the Student Report
 * (attendance/homework/exam/finance/attention aggregates for the current
 * month, all server-computed) are two DIFFERENT calls with different
 * lifecycles — never conflated into one ad hoc client-side merge.
 */
export default function StudentProfilePage() {
  const { studentId } = useParams<{ studentId: string }>();
  const { workspaceId } = useWorkspace();

  const detailQuery = useQuery({
    queryKey: workspaceId ? qk.students.detail(workspaceId, studentId) : ["student", "none"],
    queryFn: () => fetchStudentDetail(workspaceId!, studentId),
    enabled: !!workspaceId,
  });
  const reportQuery = useQuery({
    queryKey: workspaceId ? qk.reports.student(workspaceId, studentId) : ["student-report", "none"],
    queryFn: () => fetchStudentReport(workspaceId!, studentId),
    enabled: !!workspaceId,
  });

  if (detailQuery.isLoading || reportQuery.isLoading) return <LoadingRegion className="min-h-[60vh]" />;
  if (detailQuery.isError || reportQuery.isError || !detailQuery.data || !reportQuery.data) {
    return <ErrorState onRetry={() => { detailQuery.refetch(); reportQuery.refetch(); }} />;
  }

  const { student, guardians } = detailQuery.data;
  const report = reportQuery.data;

  // Status strip — derived ONLY from data already on this page (the student
  // report). Attendance/homework/exam are current-month session ratios;
  // "المتبقّي" aggregates the student's obligations. Nothing invented.
  const att = report.sessions.attendance;
  const hw = report.sessions.homework;
  const attTotal = att.present + att.absent + att.late + att.missing;
  const hwTotal = hw.done + hw.partial + hw.notDone + hw.missing;
  const examTotal = report.sessions.exam.scored + report.sessions.exam.absent + report.sessions.exam.missing;
  const totalDue = report.obligationsByMonth.reduce((s, o) => s + o.netDueMinor, 0);
  const totalPaid = report.obligationsByMonth.reduce((s, o) => s + o.amountPaidMinor, 0);
  const outstanding = Math.max(0, totalDue - totalPaid);
  const groupNames = [...new Set(report.obligationsByMonth.map((o) => o.groupName))];

  return (
    <>
      <PageHeader
        eyebrow="ملف الطالب"
        title={student.name}
        description={[`كود: ${student.studentCode}`, groupNames.length > 0 ? `المجموعات: ${groupNames.join("، ")}` : null].filter(Boolean).join(" · ")}
        actions={
          <div className="flex items-center gap-2">
            <ExportCsvButton type="STUDENT" studentId={studentId} filename={`${student.name}.csv`} />
            <Badge tone={student.status === "ACTIVE" ? "success" : "neutral"}>{student.status === "ACTIVE" ? "نشط" : "مؤرشف"}</Badge>
          </div>
        }
      />

      <div className="mb-6 flex flex-col gap-3">
        <MetricStrip>
          <MetricCell label="الحضور" value={attTotal > 0 ? `${att.present}/${attTotal}` : "—"} sub="حاضر هذا الشهر" />
          <MetricCell label="الواجب" value={hwTotal > 0 ? `${hw.done}/${hwTotal}` : "—"} sub="منجز" />
          <MetricCell label="الامتحان" value={examTotal > 0 ? `${report.sessions.exam.scored}/${examTotal}` : "—"} sub="مرصود" />
          <MetricCell
            label="المتبقّي"
            value={report.obligationsByMonth.length > 0 ? formatMoney(outstanding) : "—"}
            tone={outstanding > 0 ? "danger" : "success"}
            sub={totalDue > 0 ? `من ${formatMoney(totalDue)}` : undefined}
          />
        </MetricStrip>
        {report.activeAttentionCase ? (
          <Link
            href={`/attention/${report.activeAttentionCase.id}`}
            className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning-subtle px-4 py-2.5 transition-colors hover:bg-warning-subtle/70"
          >
            <span className="text-sm font-medium text-warning">هذا الطالب ضمن المتابعة حاليًا</span>
            <span className="shrink-0 text-sm font-medium text-warning underline">عرض الحالة</span>
          </Link>
        ) : null}
      </div>

      <Tabs defaultValue="overview" dir="rtl">
        <TabsList>
          <TabsTrigger value="overview">نظرة عامة</TabsTrigger>
          <TabsTrigger value="guardians">أولياء الأمور ({guardians.length})</TabsTrigger>
          <TabsTrigger value="enrollments">المجموعات</TabsTrigger>
          <TabsTrigger value="finance">المالية</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <OverviewTab report={report} />
        </TabsContent>
        <TabsContent value="guardians">
          <GuardiansTab studentId={studentId} guardians={guardians} />
        </TabsContent>
        <TabsContent value="enrollments">
          <EnrollmentsTab studentId={studentId} />
        </TabsContent>
        <TabsContent value="finance">
          <FinanceTab studentId={studentId} />
        </TabsContent>
      </Tabs>
    </>
  );
}
