"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, CalendarDays, LogOut, Users } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  Field,
  Input,
  SkeletonRows,
  StatusDot,
  cn,
  toast,
} from "@academic-precision/ui";
import type { StudentEnrollmentHistoryItem } from "@academic-precision/contracts";
import { useWorkspace } from "../../../../lib/workspace-provider";
import { qk } from "../../../../lib/query-keys";
import { fetchStudentEnrollments, withdrawEnrollment } from "../../../../lib/api/students";
import { TransferEnrollmentDialog } from "./transfer-enrollment-dialog";

const STATUS: Record<string, { label: string; tone: "success" | "neutral" | "danger" | "warning" }> = {
  ACTIVE: { label: "نشط", tone: "success" },
  PENDING: { label: "قيد الانتظار", tone: "neutral" },
  STOPPED: { label: "متوقف", tone: "warning" },
  WITHDRAWN: { label: "منسحب", tone: "danger" },
  TRANSFERRED: { label: "منقول", tone: "neutral" },
};
const monthLabel = (year: number, month: number) =>
  new Intl.DateTimeFormat("ar-EG-u-nu-latn", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
const dateLabel = (iso: string) => new Intl.DateTimeFormat("ar-EG-u-nu-latn", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));

export function EnrollmentsTab({ studentId }: { studentId: string }) {
  const { workspaceId, hasPermission, canWrite } = useWorkspace();
  const ws = workspaceId ?? "";
  const canManage = canWrite("CORE_OPERATIONS") && hasPermission("students.edit");

  const query = useQuery({
    queryKey: workspaceId ? qk.students.enrollments(ws, studentId) : ["enrollments", "none"],
    queryFn: () => fetchStudentEnrollments(ws, studentId),
    enabled: !!workspaceId,
  });

  const [withdrawTarget, setWithdrawTarget] = useState<StudentEnrollmentHistoryItem | null>(null);
  const [transferTarget, setTransferTarget] = useState<StudentEnrollmentHistoryItem | null>(null);

  if (query.isLoading) return <SkeletonRows rows={4} />;
  if (query.isError) return <ErrorState onRetry={() => query.refetch()} />;

  const all = query.data?.enrollments ?? [];
  if (all.length === 0) {
    return (
      <EmptyState
        icon={<Users className="h-8 w-8 text-text-tertiary" aria-hidden />}
        title="لا توجد تسجيلات بعد"
        description="سجّل الطالب في مجموعة ليبدأ تاريخ عضويته هنا."
      />
    );
  }

  const active = all.filter((e) => e.status === "ACTIVE");
  const past = all.filter((e) => e.status !== "ACTIVE");

  return (
    <div className="flex flex-col gap-6">
      {/* Current enrollments — clear and first */}
      {active.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-text-primary">المجموعة الحالية</h3>
          {active.map((e) => (
            <div key={e.id} className="flex flex-col gap-3 rounded-xl border border-brand/30 bg-brand-subtle/10 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="flex items-center gap-2 font-semibold text-text-primary">
                  <Users className="h-4 w-4 text-brand" aria-hidden />
                  {e.groupName}
                </span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
                  <span>{monthLabel(e.year, e.month)}</span>
                  <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" aria-hidden /> انضم {dateLabel(e.joinDate)}</span>
                </span>
              </div>
              {canManage ? (
                <div className="flex shrink-0 items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setTransferTarget(e)}>
                    <ArrowLeftRight className="h-4 w-4" aria-hidden />
                    نقل
                  </Button>
                  <Button variant="ghost" size="sm" className="text-danger hover:bg-danger-subtle hover:text-danger" onClick={() => setWithdrawTarget(e)}>
                    <LogOut className="h-4 w-4" aria-hidden />
                    إيقاف
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {/* Past enrollments — a compact history, not big cards */}
      {past.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-text-primary">سجل المجموعات</h3>
          <ul className="flex flex-col">
            {past.map((e, i) => {
              const s = STATUS[e.status] ?? { label: e.status, tone: "neutral" as const };
              return (
                <li key={e.id} className={cn("flex items-center gap-3 py-3", i > 0 && "border-t border-border")}>
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-border-strong" aria-hidden />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-2 text-sm font-medium text-text-primary">
                      {e.groupName}
                      <span className="text-xs font-normal text-text-tertiary">· {monthLabel(e.year, e.month)}</span>
                    </span>
                    <span className="text-xs text-text-secondary">
                      {dateLabel(e.joinDate)}
                      {e.endedAt ? ` — ${dateLabel(e.endedAt)}` : ""}
                      {e.endReason ? ` · ${e.endReason}` : ""}
                    </span>
                  </div>
                  <StatusDot tone={s.tone === "warning" ? "neutral" : s.tone} label={s.label} />
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {withdrawTarget ? (
        <WithdrawDialog studentId={studentId} enrollment={withdrawTarget} onClose={() => setWithdrawTarget(null)} />
      ) : null}
      {transferTarget ? (
        <TransferEnrollmentDialog studentId={studentId} enrollment={transferTarget} onClose={() => setTransferTarget(null)} />
      ) : null}
    </div>
  );
}

function WithdrawDialog({ studentId, enrollment, onClose }: { studentId: string; enrollment: StudentEnrollmentHistoryItem; onClose: () => void }) {
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");

  const withdraw = useMutation({
    mutationFn: () => withdrawEnrollment(workspaceId!, enrollment.id, { reason: reason.trim() || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.students.enrollments(workspaceId!, studentId) });
      queryClient.invalidateQueries({ queryKey: qk.students.detail(workspaceId!, studentId) });
      toast.success("تم إيقاف تسجيل الطالب");
      onClose();
    },
    onError: () => toast.error("تعذّر إيقاف التسجيل"),
  });

  return (
    <Dialog open onOpenChange={(v) => (!v ? onClose() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>إيقاف تسجيل الطالب في «{enrollment.groupName}»</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-relaxed text-text-secondary">
            سيصبح تسجيل الطالب في هذه المجموعة «منسحبًا». لا يُحذف الطالب ولا أي من سجلّاته أو حضوره أو مدفوعاته السابقة — يبقى التاريخ كاملًا، ويمكن تسجيله لاحقًا في مجموعة أخرى.
          </p>
          <Field label="سبب الإيقاف" htmlFor="reason" hint="اختياري">
            <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: انتقل إلى مدرّس آخر" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button variant="danger" loading={withdraw.isPending} onClick={() => withdraw.mutate()}>
            تأكيد الإيقاف
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
