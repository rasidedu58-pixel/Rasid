"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { GroupMonth, GroupMonthChangePreviewResponse } from "@academic-precision/contracts";
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Field, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@academic-precision/ui";
import { previewGroupMonthChange, applyGroupMonthChange } from "../../../../lib/api/scheduling";
import { qk } from "../../../../lib/query-keys";
import { useWorkspace } from "../../../../lib/workspace-provider";

/**
 * Edit a GroupMonth's monthly commercial config — versioned preview/apply
 * (optimistic concurrency, matches every other change-preview flow in the
 * product). Location is not editable here: no Location entity/endpoint
 * exists in the backend to pick a value from (verified before building
 * this screen), so `locationId` is never sent by this dialog.
 */
export function EditConfigDialog({ groupMonth, open, onOpenChange }: { groupMonth: GroupMonth; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();

  const [feeAmount, setFeeAmount] = useState(String(groupMonth.baseFeeMinor / 100));
  const [duePolicy, setDuePolicy] = useState(groupMonth.duePolicy);
  const [dueDay, setDueDay] = useState(groupMonth.dueDay ? String(groupMonth.dueDay) : "");
  const [joinFeePolicy, setJoinFeePolicy] = useState(groupMonth.joinFeePolicy);
  const [preview, setPreview] = useState<GroupMonthChangePreviewResponse | null>(null);

  function markDirty() {
    setPreview(null);
  }

  const previewMutation = useMutation({
    mutationFn: () =>
      previewGroupMonthChange(workspaceId!, groupMonth.id, {
        baseFeeMinor: Math.round((Number(feeAmount) || 0) * 100),
        duePolicy,
        dueDay: dueDay ? Number(dueDay) : null,
        joinFeePolicy,
      }),
    onSuccess: setPreview,
    onError: () => toast.error("تعذّرت معاينة التعديل"),
  });

  const applyMutation = useMutation({
    mutationFn: () => applyGroupMonthChange(workspaceId!, groupMonth.id, { previewToken: preview!.previewToken, expectedVersion: preview!.currentVersion }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.groups.month(workspaceId!, groupMonth.id) });
      toast.success("تم تحديث إعدادات الشهر");
      onOpenChange(false);
    },
    onError: () => toast.error("تعذّر تطبيق التعديل — قد يكون شخص آخر عدّله للتو، أعد المحاولة"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تعديل الإعداد الشهري</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="الرسوم الشهرية (جنيه)" htmlFor="edit-fee">
            <Input id="edit-fee" type="number" min={0} value={feeAmount} onChange={(e) => { setFeeAmount(e.target.value); markDirty(); }} />
          </Field>
          <Field label="سياسة الاستحقاق" htmlFor="edit-duePolicy">
            <Select value={duePolicy} onValueChange={(v) => { setDuePolicy(v as typeof duePolicy); markDirty(); }}>
              <SelectTrigger id="edit-duePolicy"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="UNIFIED">موحّدة لكل المساحة</SelectItem>
                <SelectItem value="PER_GROUP">خاصة بهذه المجموعة</SelectItem>
                <SelectItem value="OVERRIDE">استثناء لهذا الشهر</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="يوم الاستحقاق" htmlFor="edit-dueDay" hint="اختياري">
            <Input id="edit-dueDay" type="number" min={1} max={28} value={dueDay} onChange={(e) => { setDueDay(e.target.value); markDirty(); }} />
          </Field>
          <Field label="رسوم الانضمام أثناء الشهر" htmlFor="edit-joinFeePolicy">
            <Select value={joinFeePolicy} onValueChange={(v) => { setJoinFeePolicy(v as typeof joinFeePolicy); markDirty(); }}>
              <SelectTrigger id="edit-joinFeePolicy"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ASK_EVERY_TIME">اسأل في كل مرة</SelectItem>
                <SelectItem value="FULL">الرسوم كاملة دائمًا</SelectItem>
                <SelectItem value="REMAINING">حسب الحصص المتبقية دائمًا</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>

        {preview ? (
          <div className="rounded-md border border-border bg-surface-sunken p-3 text-sm text-text-secondary">
            {preview.diff.length === 0 ? "لا يوجد تغيير فعلي." : preview.diff.map((d) => <p key={d.field}>{d.field}: {String(d.before)} ← {String(d.after)}</p>)}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" loading={previewMutation.isPending} onClick={() => previewMutation.mutate()}>
            معاينة التعديل
          </Button>
          <Button disabled={!preview} loading={applyMutation.isPending} onClick={() => applyMutation.mutate()}>
            تطبيق
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
