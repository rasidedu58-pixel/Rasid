"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Badge, ErrorState, LoadingRegion, Tabs, TabsContent, TabsList, TabsTrigger } from "@academic-precision/ui";
import { PageHeader } from "../../../../components/shell/page-header";
import { ExportCsvButton } from "../../../../components/reports/export-csv-button";
import { useWorkspace } from "../../../../lib/workspace-provider";
import { qk } from "../../../../lib/query-keys";
import { fetchStudentDetail } from "../../../../lib/api/students";
import { fetchStudentReport } from "../../../../lib/api/reports";
import { OverviewTab } from "./overview-tab";
import { GuardiansTab } from "./guardians-tab";
import { FinanceTab } from "./finance-tab";

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

  return (
    <>
      <PageHeader
        title={student.name}
        description={`كود الطالب: ${student.studentCode}`}
        actions={
          <div className="flex items-center gap-2">
            <ExportCsvButton type="STUDENT" studentId={studentId} filename={`${student.name}.csv`} />
            <Badge tone={student.status === "ACTIVE" ? "success" : "neutral"}>{student.status === "ACTIVE" ? "نشط" : "مؤرشف"}</Badge>
          </div>
        }
      />

      <Tabs defaultValue="overview" dir="rtl">
        <TabsList>
          <TabsTrigger value="overview">نظرة عامة</TabsTrigger>
          <TabsTrigger value="guardians">أولياء الأمور ({guardians.length})</TabsTrigger>
          <TabsTrigger value="finance">المالية</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <OverviewTab report={report} />
        </TabsContent>
        <TabsContent value="guardians">
          <GuardiansTab studentId={studentId} guardians={guardians} />
        </TabsContent>
        <TabsContent value="finance">
          <FinanceTab studentId={studentId} />
        </TabsContent>
      </Tabs>
    </>
  );
}
