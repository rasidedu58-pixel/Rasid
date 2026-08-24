"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, ConfirmDialog, ErrorState, LoadingRegion, SectionCard, formatDateTime, formatMoney, formatWeekday, toast, useConfirmDialog } from "@academic-precision/ui";
import { PageHeader } from "../../../../components/shell/page-header";
import { useWorkspace } from "../../../../lib/workspace-provider";
import { qk } from "../../../../lib/query-keys";
import { fetchGroupMonth, fetchGroupMonthSchedule, fetchSessions, fetchGroup, cancelSession } from "../../../../lib/api/scheduling";
import { fetchGroupReport } from "../../../../lib/api/reports";
import { EditConfigDialog } from "./edit-config-dialog";
import { ScheduleEditorDialog } from "./schedule-editor-dialog";
import { EnrollStudentDialog } from "./enroll-student-dialog";

const SESSION_STATUS_LABEL: Record<string, { label: string; tone: "brand" | "success" | "neutral" | "danger" | "warning" }> = {
  SCHEDULED: { label: "مجدولة", tone: "neutral" },
  IN_PROGRESS: { label: "جارية", tone: "brand" },
  COMPLETED: { label: "مكتملة", tone: "success" },
  CANCELLED: { label: "ملغاة", tone: "danger" },
  RESCHEDULED: { label: "مؤجّلة", tone: "warning" },
};

const DUE_POLICY_LABEL: Record<string, string> = { UNIFIED: "موحّدة", PER_GROUP: "خاصة بالمجموعة", OVERRIDE: "استثناء لهذا الشهر" };
const JOIN_FEE_POLICY_LABEL: Record<string, string> = { ASK_EVERY_TIME: "اسأل في كل مرة", FULL: "رسوم كاملة دائمًا", REMAINING: "حسب الحصص المتبقية دائمًا" };

/**
 * GroupMonth detail — the screen that closes the rest of Phase 11's month-
 * management gap: monthly fee/due/join-fee config, weekly schedule, the
 * sessions it generated, and the roster (enroll a student). Reached from
 * `/months/:monthId` via the new `GET /months/:id/group-months` endpoint.
 */
export default function GroupMonthDetailPage() {
  const { groupMonthId } = useParams<{ groupMonthId: string }>();
  const { workspaceId, canWrite } = useWorkspace();
  const queryClient = useQueryClient();

  const [editConfigOpen, setEditConfigOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const cancelDialog = useConfirmDialog();
  const [sessionToCancel, setSessionToCancel] = useState<string | null>(null);

  const groupMonthQuery = useQuery({
    queryKey: workspaceId ? qk.groups.month(workspaceId, groupMonthId) : ["group-month", "none"],
    queryFn: () => fetchGroupMonth(workspaceId!, groupMonthId),
    enabled: !!workspaceId,
  });
  const scheduleQuery = useQuery({
    queryKey: workspaceId ? qk.groups.schedule(workspaceId, groupMonthId) : ["schedule", "none"],
    queryFn: () => fetchGroupMonthSchedule(workspaceId!, groupMonthId),
    enabled: !!workspaceId,
  });
  const sessionsQuery = useQuery({
    queryKey: workspaceId ? qk.sessions.list(workspaceId, { groupMonthId }) : ["sessions-for-gm", "none"],
    queryFn: () => fetchSessions(workspaceId!, { groupMonthId, limit: 100 }),
    enabled: !!workspaceId,
  });
  const groupQuery = useQuery({
    queryKey: workspaceId && groupMonthQuery.data ? qk.groups.detail(workspaceId, groupMonthQuery.data.groupId) : ["group", "none"],
    queryFn: () => fetchGroup(workspaceId!, groupMonthQuery.data!.groupId),
    enabled: !!workspaceId && !!groupMonthQuery.data,
  });
  // Roster (enrollments) has no standalone list endpoint — the Group Report
  // is the only existing source, and it only ever reflects the workspace's
  // CURRENT month. For an archived GroupMonth this section is disabled
  // rather than showing stale/wrong data (see the section below).
  const reportQuery = useQuery({
    queryKey: workspaceId && groupMonthQuery.data ? qk.reports.group(workspaceId, groupMonthQuery.data.groupId) : ["group-report", "none"],
    queryFn: () => fetchGroupReport(workspaceId!, groupMonthQuery.data!.groupId),
    enabled: !!workspaceId && !!groupMonthQuery.data,
  });

  const cancelMutation = useMutation({
    mutationFn: (sessionId: string) => cancelSession(workspaceId!, sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.sessions.list(workspaceId!, { groupMonthId }) });
      toast.success("تم إلغاء الحصة");
      cancelDialog.closeDialog();
    },
    onError: () => toast.error("تعذّر إلغاء الحصة"),
  });

  if (groupMonthQuery.isLoading || scheduleQuery.isLoading || sessionsQuery.isLoading) return <LoadingRegion className="min-h-[60vh]" />;
  if (groupMonthQuery.isError || scheduleQuery.isError || sessionsQuery.isError || !groupMonthQuery.data || !scheduleQuery.data || !sessionsQuery.data) {
    return (
      <ErrorState
        onRetry={() => {
          groupMonthQuery.refetch();
          scheduleQuery.refetch();
          sessionsQuery.refetch();
        }}
      />
    );
  }

  const groupMonth = groupMonthQuery.data;
  const isCurrentMonthRoster = reportQuery.data?.currentMonth?.id === groupMonth.operatingMonthId;
  const canManage = canWrite("CORE_OPERATIONS");

  return (
    <>
      <PageHeader
        title={groupQuery.data?.name ?? "إعداد المجموعة الشهري"}
        actions={
          <div className="flex items-center gap-3">
            {groupQuery.data ? (
              <Link href={`/groups/${groupQuery.data.id}`} className="text-sm text-brand hover:underline">
                فتح صفحة المجموعة
              </Link>
            ) : null}
            <Badge tone={groupMonth.monthlyStatus === "ACTIVE" ? "success" : "neutral"}>{groupMonth.monthlyStatus === "ACTIVE" ? "نشطة" : "مؤرشفة"}</Badge>
          </div>
        }
      />

      <div className="flex flex-col gap-4">
        <SectionCard title="الإعداد الشهري" action={canManage ? <Button size="sm" variant="outline" onClick={() => setEditConfigOpen(true)}>تعديل</Button> : undefined}>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="الرسوم الشهرية" value={formatMoney(groupMonth.baseFeeMinor, groupMonth.currencyCode)} />
            <Stat label="سياسة الاستحقاق" value={DUE_POLICY_LABEL[groupMonth.duePolicy] ?? groupMonth.duePolicy} />
            <Stat label="يوم الاستحقاق" value={groupMonth.dueDay ? String(groupMonth.dueDay) : "—"} />
            <Stat label="رسوم الانضمام أثناء الشهر" value={JOIN_FEE_POLICY_LABEL[groupMonth.joinFeePolicy] ?? groupMonth.joinFeePolicy} />
          </div>
        </SectionCard>

        <SectionCard title="الجدول الأسبوعي" action={canManage ? <Button size="sm" variant="outline" onClick={() => setScheduleOpen(true)}>تعديل الجدول</Button> : undefined}>
          {scheduleQuery.data.rules.length === 0 ? (
            <p className="text-sm text-text-secondary">لا يوجد جدول بعد — لن تُنشأ حصص لهذه المجموعة هذا الشهر حتى تضيف موعدًا.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm text-text-primary">
              {scheduleQuery.data.rules.map((r) => (
                <li key={r.id}>{formatWeekday(nextWeekdayDate(r.weekday))} — {r.startTime.slice(0, 5)} ({r.durationMinutes} دقيقة)</li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="الحصص">
          {sessionsQuery.data.items.length === 0 ? (
            <p className="text-sm text-text-secondary">لا توجد حصص مولّدة بعد.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {sessionsQuery.data.items.map((s) => {
                const status = SESSION_STATUS_LABEL[s.status] ?? { label: s.status, tone: "neutral" as const };
                return (
                  <li key={s.id} className="flex items-center justify-between py-2">
                    <Link href={`/sessions/${s.id}`} className="text-sm text-text-primary hover:text-brand hover:underline">
                      {formatDateTime(s.scheduledAt)}
                    </Link>
                    <div className="flex items-center gap-2">
                      <Badge tone={status.tone}>{status.label}</Badge>
                      {canManage && s.status === "SCHEDULED" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setSessionToCancel(s.id);
                            cancelDialog.openDialog();
                          }}
                        >
                          إلغاء
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="الطلاب المسجّلون"
          action={canManage && isCurrentMonthRoster ? <Button size="sm" onClick={() => setEnrollOpen(true)}>تسجيل طالب</Button> : undefined}
        >
          {!isCurrentMonthRoster ? (
            <p className="text-sm text-text-secondary">قائمة الطلاب متاحة فقط للشهر التشغيلي الحالي.</p>
          ) : reportQuery.data && reportQuery.data.roster.length > 0 ? (
            <ul className="flex flex-col divide-y divide-border">
              {reportQuery.data.roster.map((r) => (
                <li key={r.enrollmentId} className="flex items-center justify-between py-2">
                  <Link href={`/students/${r.studentId}`} className="text-sm text-text-primary hover:text-brand hover:underline">
                    {r.studentName}
                  </Link>
                  <Badge tone="neutral">{r.status === "ACTIVE" ? "نشط" : r.status}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-text-secondary">لا يوجد طلاب مسجّلون بعد.</p>
          )}
        </SectionCard>
      </div>

      <EditConfigDialog groupMonth={groupMonth} open={editConfigOpen} onOpenChange={setEditConfigOpen} />
      <ScheduleEditorDialog groupMonthId={groupMonth.id} currentRules={scheduleQuery.data.rules} open={scheduleOpen} onOpenChange={setScheduleOpen} />
      <EnrollStudentDialog groupMonth={groupMonth} open={enrollOpen} onOpenChange={setEnrollOpen} />
      <ConfirmDialog
        open={cancelDialog.open}
        onOpenChange={cancelDialog.setOpen}
        title="إلغاء الحصة؟"
        description="لن يمكن التراجع عن هذا الإجراء من هنا."
        destructive
        loading={cancelMutation.isPending}
        onConfirm={() => {
          if (sessionToCancel) cancelMutation.mutate(sessionToCancel);
        }}
      />
    </>
  );
}

/** `weekday` here is a pure 0..6 index (Monday=0), not a real date — this maps it to the nearest matching real date only so `formatWeekday` can render the Arabic day NAME. No date arithmetic beyond that is used anywhere. */
function nextWeekdayDate(weekday: number): Date {
  const base = new Date(Date.UTC(2024, 0, 1 + weekday)); // 2024-01-01 is a Monday (weekday 0)
  return base;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-text-secondary">{label}</p>
      <p className="mt-1 text-sm font-medium text-text-primary">{value}</p>
    </div>
  );
}
