"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, CalendarClock, CheckCircle2, ClipboardList, Clock, Users, XCircle } from "lucide-react";
import {
  Badge,
  Button,
  ConfirmDialog,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  StatusDot,
  cn,
  formatTime,
  formatWeekday,
  toast,
  useConfirmDialog,
} from "@academic-precision/ui";
import type { SessionCalendarItem } from "@academic-precision/contracts";
import { useWorkspace } from "../../../lib/workspace-provider";
import { qk } from "../../../lib/query-keys";
import { fetchSessionReview } from "../../../lib/api/session-mode";
import { cancelSession } from "../../../lib/api/scheduling";
import { deriveSessionDisplay, primaryActionLabel, sessionEnd } from "./session-status";

const arNum = (n: number) => new Intl.NumberFormat("ar-EG").format(n);

function dayLabel(iso: string): string {
  const d = new Date(iso);
  return `${formatWeekday(d)} ${new Intl.DateTimeFormat("ar-EG-u-nu-latn", { day: "numeric", month: "long" }).format(d)}`;
}

export function SessionQuickDrawer({
  item,
  open,
  onOpenChange,
  onChanged,
}: {
  item: SessionCalendarItem | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged?: () => void;
}) {
  const router = useRouter();
  const { workspaceId, hasPermission } = useWorkspace();
  const confirm = useConfirmDialog();

  const display = item ? deriveSessionDisplay(item) : null;
  // The review (attendance/homework/exam completeness) is only meaningful once
  // records exist — i.e. the session is running or already completed.
  const reviewRelevant = item?.status === "IN_PROGRESS" || item?.status === "COMPLETED";

  const review = useQuery({
    queryKey: item ? qk.sessions.review(workspaceId ?? "", item.id) : ["session-review", "none"],
    queryFn: () => fetchSessionReview(workspaceId!, item!.id),
    enabled: !!workspaceId && !!item && open && reviewRelevant,
  });

  const cancel = useMutation({
    mutationFn: () => cancelSession(workspaceId!, item!.id),
    onSuccess: () => {
      toast.success("تم إلغاء الحصة");
      confirm.closeDialog();
      onChanged?.();
      onOpenChange(false);
    },
    onError: () => toast.error("تعذّر إلغاء الحصة"),
  });

  if (!item || !display) return null;

  const start = new Date(item.scheduledAt);
  const end = sessionEnd(item);
  const canManage = hasPermission("sessions.manage");
  const canCancel = canManage && item.status === "SCHEDULED";
  const missingCount = review.data?.missingRecords.length ?? 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="end" className="flex w-full max-w-md flex-col">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <Badge tone={display.badgeTone}>{display.label}</Badge>
            {display.live ? <span className="h-2 w-2 animate-pulse rounded-full bg-brand" aria-hidden /> : null}
          </div>
          <SheetTitle className="mt-1 truncate">{item.groupName}</SheetTitle>
        </SheetHeader>

        <div className="mt-5 flex flex-1 flex-col gap-3 overflow-y-auto pb-4">
          <InfoRow icon={<CalendarClock className="h-4 w-4" aria-hidden />} label="اليوم" value={dayLabel(item.scheduledAt)} />
          <InfoRow
            icon={<Clock className="h-4 w-4" aria-hidden />}
            label="الوقت"
            value={<span className="tabular-nums">{formatTime(start)} – {formatTime(end)}</span>}
          />
          <InfoRow icon={<Users className="h-4 w-4" aria-hidden />} label="الطلاب" value={`${arNum(item.studentCount)} طالبًا`} />

          {/* Completion checklist — only when records are meaningful */}
          {reviewRelevant ? (
            <div className="mt-2 rounded-xl border border-border bg-surface p-4">
              <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
                <ClipboardList className="h-4 w-4 text-brand" aria-hidden />
                استكمال التسجيل
              </p>
              {review.isLoading ? (
                <p className="text-sm text-text-tertiary">جارٍ التحميل…</p>
              ) : review.isError ? (
                <p className="text-sm text-danger">تعذّر تحميل حالة الاستكمال.</p>
              ) : review.data ? (
                (() => {
                  const a = review.data.attendanceSummary;
                  const h = review.data.homeworkSummary;
                  const aRecorded = a.present + a.absent + a.late;
                  const aTotal = aRecorded + a.missing;
                  const hRecorded = h.done + h.partial + h.notDone + h.noHomework;
                  const hTotal = hRecorded + h.missing;
                  return (
                <div className="flex flex-col gap-2.5">
                  <ChecklistLine ok={a.missing === 0} label="الحضور" detail={`${arNum(aRecorded)}/${arNum(aTotal)}`} />
                  <ChecklistLine ok={h.missing === 0} label="الواجب" detail={`${arNum(hRecorded)}/${arNum(hTotal)}`} />
                  <div className="mt-1 border-t border-border pt-2.5">
                    {review.data.canComplete ? (
                      <p className="flex items-center gap-1.5 text-sm text-success">
                        <CheckCircle2 className="h-4 w-4" aria-hidden />
                        كل السجلات مكتملة
                      </p>
                    ) : (
                      <p className="flex items-center gap-1.5 text-sm text-warning">
                        <XCircle className="h-4 w-4" aria-hidden />
                        {missingCount > 0 ? `${arNum(missingCount)} سجل ناقص` : "بحاجة إلى بدء الحصة"}
                      </p>
                    )}
                  </div>
                </div>
                  );
                })()
              ) : null}
            </div>
          ) : (
            <div className="mt-2 flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-sm text-text-secondary">
              <StatusDot tone={display.key === "needs_completion" ? "danger" : "neutral"} label={display.label} />
              {display.key === "needs_completion"
                ? "انتهى وقت الحصة ولم يبدأ تسجيلها بعد."
                : display.key === "upcoming" || display.key === "soon"
                  ? "لم تبدأ الحصة بعد."
                  : "لا يوجد تسجيل لهذه الحصة."}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <Button
            onClick={() => {
              router.push(`/sessions/${item.id}`);
              onOpenChange(false);
            }}
          >
            {primaryActionLabel(display.key)}
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Button>
          {primaryActionLabel(display.key) !== "فتح الحصة كاملة" ? (
            <Button
              variant="ghost"
              onClick={() => {
                router.push(`/sessions/${item.id}`);
                onOpenChange(false);
              }}
            >
              فتح الحصة كاملة
            </Button>
          ) : null}
          {canCancel ? (
            <Button variant="ghost" className="text-danger hover:bg-danger-subtle hover:text-danger" onClick={() => confirm.openDialog()}>
              إلغاء الحصة
            </Button>
          ) : null}
        </div>

        <ConfirmDialog
          open={confirm.open}
          onOpenChange={confirm.setOpen}
          title="إلغاء الحصة"
          description="سيتم إلغاء هذه الحصة. لا يؤثر ذلك على الحصص الأخرى أو السجلات السابقة."
          destructive
          loading={cancel.isPending}
          onConfirm={() => cancel.mutate()}
        />
      </SheetContent>
    </Sheet>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-2.5">
      <span className="flex items-center gap-2 text-sm text-text-secondary">
        <span className="text-text-tertiary">{icon}</span>
        {label}
      </span>
      <span className="text-sm font-medium text-text-primary">{value}</span>
    </div>
  );
}

function ChecklistLine({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="flex items-center gap-2">
        <span className={cn("flex h-5 w-5 items-center justify-center rounded-full", ok ? "bg-success-subtle text-success" : "bg-warning-subtle text-warning")}>
          {ok ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : <Clock className="h-3.5 w-3.5" aria-hidden />}
        </span>
        <span className="text-text-primary">{label}</span>
      </span>
      <span className="tabular-nums text-text-secondary">{detail}</span>
    </div>
  );
}
