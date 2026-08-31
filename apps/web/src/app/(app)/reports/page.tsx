"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileBarChart } from "lucide-react";
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingRegion,
  MetricCell,
  MetricStrip,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SectionCard,
  formatMoney,
  formatMonthLabel,
} from "@academic-precision/ui";
import { PageHeader } from "../../../components/shell/page-header";
import { useWorkspace } from "../../../lib/workspace-provider";
import { qk } from "../../../lib/query-keys";
import { fetchGroups, fetchMonths } from "../../../lib/api/scheduling";
import { fetchGroupReport, fetchMonthlyReport, fetchStudentReport } from "../../../lib/api/reports";
import { ReportExportButtons } from "../../../components/reports/report-export-buttons";

type ReportType = "MONTHLY" | "GROUP" | "STUDENT";
const REPORT_TABS: { key: ReportType; label: string }[] = [
  { key: "MONTHLY", label: "التقرير الشهري" },
  { key: "GROUP", label: "تقرير مجموعة" },
  { key: "STUDENT", label: "تقرير طالب" },
];

/**
 * مركز التقارير — pick a report type + its target, preview it, then export a
 * branded Excel / PDF. Reuses the same server DTOs the export renders, so the
 * preview and the file always match. Finance figures appear only when the
 * server includes them (redacted for callers without finance.overview).
 */
export default function ReportsPage() {
  const { workspaceId } = useWorkspace();
  const [type, setType] = useState<ReportType>("MONTHLY");

  return (
    <>
      <PageHeader eyebrow="مركز التقارير" title="التقارير" />
      <div className="mb-5 flex flex-wrap gap-1.5">
        {REPORT_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setType(t.key)}
            className={
              type === t.key
                ? "rounded-full bg-brand px-4 py-1.5 text-sm font-medium text-brand-foreground"
                : "rounded-full border border-border px-4 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-sunken"
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {!workspaceId ? <LoadingRegion /> : type === "MONTHLY" ? <MonthlyReport workspaceId={workspaceId} /> : type === "GROUP" ? <GroupReportView workspaceId={workspaceId} /> : <StudentReportView workspaceId={workspaceId} />}
    </>
  );
}

// --- Monthly ----------------------------------------------------------------
function MonthlyReport({ workspaceId }: { workspaceId: string }) {
  const [selectedMonthId, setSelectedMonthId] = useState<string | undefined>();
  const monthsQuery = useQuery({ queryKey: qk.months.list(workspaceId), queryFn: () => fetchMonths(workspaceId) });
  const months = monthsQuery.data?.months ?? [];
  // Bug fix: drive the query off the EFFECTIVE month (current-month fallback),
  // not the unseeded manual selection — otherwise the query never fires on
  // first load and the page wrongly shows an error with no request made.
  const monthId = selectedMonthId ?? months.find((m) => m.status === "CURRENT")?.id;

  const report = useQuery({
    queryKey: monthId ? qk.reports.monthly(workspaceId, monthId) : ["reports", "monthly", "none"],
    queryFn: () => fetchMonthlyReport(workspaceId, monthId!),
    enabled: !!monthId,
  });

  if (!monthsQuery.isLoading && months.length === 0) {
    return <EmptyState icon={<FileBarChart className="h-8 w-8 text-text-tertiary" aria-hidden />} title="لا يوجد شهر تشغيلي بعد" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-xs flex-1">
          <Select value={monthId} onValueChange={setSelectedMonthId}>
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
        {monthId ? <ReportExportButtons type="MONTHLY_TEACHER" monthId={monthId} fallbackName="التقرير-الشهري" /> : null}
      </div>

      {!monthId ? (
        <Card className="p-6 text-center text-sm text-text-secondary">اختر شهرًا لعرض تقريره.</Card>
      ) : report.isLoading ? (
        <LoadingRegion />
      ) : report.isError || !report.data ? (
        <ErrorState onRetry={() => report.refetch()} />
      ) : (
        <MonthlyPreview data={report.data} />
      )}
    </div>
  );
}

function MonthlyPreview({ data }: { data: import("@academic-precision/contracts").MonthlyTeacherReportResponse }) {
  const t = data.totals;
  return (
    <div className="flex flex-col gap-6">
      <MetricStrip>
        <MetricCell label="الطلاب" value={t.studentsCount} />
        <MetricCell label="الحصص" value={t.sessionsCount} />
        {t.collection ? <MetricCell label="المتبقّي" value={formatMoney(t.collection.totalRemainingMinor)} /> : null}
        {t.overdueCount != null ? <MetricCell label="متأخرات" value={t.overdueCount} tone={t.overdueCount > 0 ? "danger" : "default"} /> : null}
      </MetricStrip>

      <SectionCard title="المجموعات" description="ملخّص كل مجموعة ضمن نطاق رؤيتك لهذا الشهر.">
        {data.groups.length === 0 ? (
          <p className="text-sm text-text-secondary">لا توجد مجموعات ضمن نطاق رؤيتك لهذا الشهر.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {data.groups.map((g) => (
              <li key={g.groupId} className="flex items-center justify-between gap-3 py-2.5">
                <span className="truncate text-sm font-medium text-text-primary">{g.groupName}</span>
                <span className="shrink-0 text-sm text-text-secondary tabular-nums">
                  {g.studentsCount} طالب · {g.sessionsCount} حصة
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <MetricStrip columns={2}>
        <MetricCell label="حالات متابعة مفتوحة" value={t.openAttentionCount} tone={t.openAttentionCount > 0 ? "warning" : "default"} />
        <MetricCell label="متابعات مجدولة" value={t.openFollowupsCount} />
      </MetricStrip>
    </div>
  );
}

// --- Group ------------------------------------------------------------------
function GroupReportView({ workspaceId }: { workspaceId: string }) {
  const [groupId, setGroupId] = useState<string | undefined>();
  const groupsQuery = useQuery({ queryKey: qk.groups.list(workspaceId), queryFn: () => fetchGroups(workspaceId) });
  const groups = groupsQuery.data?.groups ?? [];
  const report = useQuery({
    queryKey: groupId ? qk.reports.group(workspaceId, groupId) : ["reports", "group", "none"],
    queryFn: () => fetchGroupReport(workspaceId, groupId!),
    enabled: !!groupId,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-xs flex-1">
          <Select value={groupId} onValueChange={setGroupId}>
            <SelectTrigger>
              <SelectValue placeholder="اختر المجموعة" />
            </SelectTrigger>
            <SelectContent>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {groupId ? <ReportExportButtons type="GROUP" groupId={groupId} fallbackName="تقرير-المجموعة" /> : null}
      </div>

      {!groupId ? (
        <Card className="p-6 text-center text-sm text-text-secondary">اختر مجموعة لعرض تقريرها.</Card>
      ) : report.isLoading ? (
        <LoadingRegion />
      ) : report.isError || !report.data ? (
        <ErrorState onRetry={() => report.refetch()} />
      ) : (
        <GroupPreview data={report.data} />
      )}
    </div>
  );
}

function GroupPreview({ data }: { data: import("@academic-precision/contracts").GroupReportResponse }) {
  const a = data.attendance;
  const h = data.homework;
  return (
    <div className="flex flex-col gap-6">
      <MetricStrip>
        <MetricCell label="الطلاب" value={data.roster.length} />
        <MetricCell label="الحصص (مكتملة/كلي)" value={`${data.sessions.completed}/${data.sessions.total}`} />
        <MetricCell label="سجلات ناقصة" value={data.missingRecordsCount} tone={data.missingRecordsCount > 0 ? "warning" : "default"} />
        {data.collection ? <MetricCell label="المتبقّي" value={formatMoney(data.collection.totalRemainingMinor)} /> : null}
      </MetricStrip>
      <MetricStrip>
        <MetricCell label="حاضر" value={a.present} />
        <MetricCell label="غائب" value={a.absent} />
        <MetricCell label="متأخر" value={a.late} />
        <MetricCell label="واجب مُنجز" value={h.done} />
      </MetricStrip>
      <SectionCard title="قائمة الطلاب">
        {data.roster.length === 0 ? (
          <p className="text-sm text-text-secondary">لا يوجد طلاب في هذه المجموعة.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {data.roster.map((r) => (
              <li key={r.enrollmentId} className="py-2 text-sm text-text-primary">{r.studentName}</li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

// --- Student ----------------------------------------------------------------
function StudentReportView({ workspaceId }: { workspaceId: string }) {
  const [groupId, setGroupId] = useState<string | undefined>();
  const [studentId, setStudentId] = useState<string | undefined>();
  const groupsQuery = useQuery({ queryKey: qk.groups.list(workspaceId), queryFn: () => fetchGroups(workspaceId) });
  const rosterQuery = useQuery({
    queryKey: groupId ? qk.reports.group(workspaceId, groupId) : ["reports", "group", "none"],
    queryFn: () => fetchGroupReport(workspaceId, groupId!),
    enabled: !!groupId,
  });
  const report = useQuery({
    queryKey: studentId ? qk.reports.student(workspaceId, studentId) : ["reports", "student", "none"],
    queryFn: () => fetchStudentReport(workspaceId, studentId!),
    enabled: !!studentId,
  });
  const groups = groupsQuery.data?.groups ?? [];
  const roster = useMemo(() => rosterQuery.data?.roster ?? [], [rosterQuery.data]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <div className="w-52">
            <Select value={groupId} onValueChange={(v) => { setGroupId(v); setStudentId(undefined); }}>
              <SelectTrigger>
                <SelectValue placeholder="اختر المجموعة" />
              </SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-52">
            <Select value={studentId} onValueChange={setStudentId} disabled={!groupId || roster.length === 0}>
              <SelectTrigger>
                <SelectValue placeholder="اختر الطالب" />
              </SelectTrigger>
              <SelectContent>
                {roster.map((r) => (
                  <SelectItem key={r.studentId} value={r.studentId}>{r.studentName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {studentId ? <ReportExportButtons type="STUDENT" studentId={studentId} fallbackName="تقرير-الطالب" /> : null}
      </div>

      {!studentId ? (
        <Card className="p-6 text-center text-sm text-text-secondary">اختر مجموعة ثم طالبًا لعرض تقريره.</Card>
      ) : report.isLoading ? (
        <LoadingRegion />
      ) : report.isError || !report.data ? (
        <ErrorState onRetry={() => report.refetch()} />
      ) : (
        <StudentPreview data={report.data} />
      )}
    </div>
  );
}

function StudentPreview({ data }: { data: import("@academic-precision/contracts").StudentReportResponse }) {
  const s = data.sessions;
  return (
    <div className="flex flex-col gap-6">
      <SectionCard title={data.student.name} description={data.currentMonth ? formatMonthLabel(data.currentMonth.year, data.currentMonth.month) : undefined}>
        <MetricStrip>
          <MetricCell label="الحصص" value={s.total} />
          <MetricCell label="حاضر" value={s.attendance.present} />
          <MetricCell label="غائب" value={s.attendance.absent} />
          <MetricCell label="واجب مُنجز" value={s.homework.done} />
        </MetricStrip>
      </SectionCard>
      {data.obligationsByMonth.length > 0 ? (
        <SectionCard title="الالتزامات المالية">
          <ul className="flex flex-col divide-y divide-border">
            {data.obligationsByMonth.map((o) => (
              <li key={`${o.monthId}-${o.groupId}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="text-text-primary">{o.groupName}</span>
                <span className="text-text-secondary tabular-nums">المتبقّي {formatMoney(o.remainingMinor)}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}
    </div>
  );
}
