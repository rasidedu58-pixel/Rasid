"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
  formatMoney,
  toast,
} from "@academic-precision/ui";
import type { EnrollmentTransferPreviewResponse, StudentEnrollmentHistoryItem, TransferFeeMethod } from "@academic-precision/contracts";
import { useWorkspace } from "../../../../lib/workspace-provider";
import { qk } from "../../../../lib/query-keys";
import { fetchMonths, fetchGroupMonthsForMonth, fetchGroups } from "../../../../lib/api/scheduling";
import { previewEnrollmentTransfer, transferEnrollment } from "../../../../lib/api/students";

const FEE_LABELS: Record<TransferFeeMethod, string> = {
  FULL_MONTH: "الشهر كامل",
  REMAINING_SESSIONS: "بحسب الحصص المتبقية",
};

/**
 * Transfer a student from their current group to another — resolving the
 * target group's GroupMonth in the CURRENT operating month, previewing the
 * move (from → to + fee), then confirming. The backend performs it atomically
 * (close old TRANSFERRED + open new for the SAME student), preserving all
 * history; same-group and double-active transfers are rejected there too.
 */
export function TransferEnrollmentDialog({ studentId, enrollment, onClose }: { studentId: string; enrollment: StudentEnrollmentHistoryItem; onClose: () => void }) {
  const { workspaceId } = useWorkspace();
  const ws = workspaceId ?? "";
  const queryClient = useQueryClient();

  const [targetGroupId, setTargetGroupId] = useState<string>("");
  const [feeMethod, setFeeMethod] = useState<TransferFeeMethod>("FULL_MONTH");
  const [preview, setPreview] = useState<{ token: string; data: EnrollmentTransferPreviewResponse; targetName: string } | null>(null);

  const monthsQuery = useQuery({ queryKey: qk.months.list(ws), queryFn: () => fetchMonths(ws), enabled: !!workspaceId });
  const currentMonth = monthsQuery.data?.months.find((m) => m.status === "CURRENT") ?? null;

  const groupMonthsQuery = useQuery({
    queryKey: currentMonth ? qk.months.groupMonths(ws, currentMonth.id) : ["gm", "none"],
    queryFn: () => fetchGroupMonthsForMonth(ws, currentMonth!.id),
    enabled: !!workspaceId && !!currentMonth,
  });
  const groupsQuery = useQuery({ queryKey: qk.groups.list(ws), queryFn: () => fetchGroups(ws), enabled: !!workspaceId });

  // Valid targets = groups prepared for the current month, excluding the student's own group.
  const targets = useMemo(() => {
    const names = new Map((groupsQuery.data?.groups ?? []).map((g) => [g.id, g.name]));
    return (groupMonthsQuery.data?.groupMonths ?? [])
      .filter((gm) => gm.groupId !== enrollment.groupId)
      .map((gm) => ({ groupMonthId: gm.id, groupId: gm.groupId, name: names.get(gm.groupId) ?? "مجموعة" }));
  }, [groupMonthsQuery.data, groupsQuery.data, enrollment.groupId]);

  const previewMut = useMutation({
    mutationFn: async () => {
      const target = targets.find((t) => t.groupId === targetGroupId);
      if (!target) throw new Error("no-target");
      const data = await previewEnrollmentTransfer(ws, enrollment.id, { targetGroupMonthId: target.groupMonthId, feeMethod });
      return { data, targetName: target.name };
    },
    onSuccess: ({ data, targetName }) => setPreview({ token: data.previewToken, data, targetName }),
    onError: () => toast.error("تعذّر حساب معاينة النقل"),
  });

  const confirmMut = useMutation({
    mutationFn: () => transferEnrollment(ws, enrollment.id, { previewToken: preview!.token, feeMethod }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.students.enrollments(ws, studentId) });
      queryClient.invalidateQueries({ queryKey: qk.students.detail(ws, studentId) });
      toast.success("تم نقل الطالب");
      onClose();
    },
    onError: () => toast.error("تعذّر إتمام النقل"),
  });

  const noTargets = !!currentMonth && targets.length === 0;
  const loadingTargets = monthsQuery.isLoading || groupMonthsQuery.isLoading || groupsQuery.isLoading;

  return (
    <Dialog open onOpenChange={(v) => (!v ? onClose() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>نقل الطالب إلى مجموعة أخرى</DialogTitle>
        </DialogHeader>

        {!currentMonth && !monthsQuery.isLoading ? (
          <p className="text-sm text-text-secondary">لا يوجد شهر تشغيلي حالي. جهّز الشهر أولًا لتصبح المجموعات متاحة للنقل.</p>
        ) : preview ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-center gap-3 rounded-xl border border-border bg-surface p-4 text-center">
              <span className="text-sm font-medium text-text-secondary">{enrollment.groupName}</span>
              <ArrowLeft className="h-4 w-4 shrink-0 text-brand" aria-hidden />
              <span className="text-sm font-semibold text-text-primary">{preview.targetName}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
              <span className="text-sm text-text-secondary">رسوم المجموعة الجديدة ({FEE_LABELS[feeMethod]})</span>
              <span className="text-base font-bold tabular-nums text-brand">{formatMoney(preview.data.calculatedDueMinor)}</span>
            </div>
            <p className="text-xs leading-relaxed text-text-tertiary">
              سيُغلق تسجيل الطالب الحالي كـ«منقول» ويُفتح تسجيل جديد في المجموعة الجديدة. لا يتأثّر أي حضور أو مدفوعات أو حصص سابقة تخص المجموعة القديمة.
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setPreview(null)}>رجوع</Button>
              <Button loading={confirmMut.isPending} onClick={() => confirmMut.mutate()}>تأكيد النقل</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <Field label="المجموعة الجديدة" htmlFor="target">
              {noTargets ? (
                <p className="text-sm text-text-secondary">لا توجد مجموعات أخرى مُجهّزة لهذا الشهر يمكن النقل إليها.</p>
              ) : (
                <Select value={targetGroupId} onValueChange={setTargetGroupId} disabled={loadingTargets}>
                  <SelectTrigger id="target"><SelectValue placeholder={loadingTargets ? "جارٍ التحميل…" : "اختر مجموعة"} /></SelectTrigger>
                  <SelectContent>
                    {targets.map((t) => (
                      <SelectItem key={t.groupId} value={t.groupId}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>

            <div>
              <p className="mb-2 text-sm font-medium text-text-primary">طريقة حساب رسوم الشهر الجديد</p>
              <div className="flex gap-2">
                {(Object.keys(FEE_LABELS) as TransferFeeMethod[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setFeeMethod(m)}
                    className={cn(
                      "focus-ring flex-1 rounded-lg border px-3 py-2 text-sm transition-colors",
                      feeMethod === m ? "border-brand bg-brand-subtle/50 font-medium text-brand-subtle-foreground" : "border-border text-text-secondary hover:bg-surface-sunken",
                    )}
                  >
                    {FEE_LABELS[m]}
                  </button>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>إلغاء</Button>
              <Button disabled={!targetGroupId} loading={previewMut.isPending} onClick={() => previewMut.mutate()}>
                معاينة النقل
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
