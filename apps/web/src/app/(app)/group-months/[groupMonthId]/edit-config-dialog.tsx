"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { GroupMonth, GroupMonthChangePreviewResponse } from "@academic-precision/contracts";
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Field, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@academic-precision/ui";
import { previewGroupMonthChange, applyGroupMonthChange } from "../../../../lib/api/scheduling";
import {
  DUE_DAY_EXPLAINER,
  DUE_DAY_LABEL,
  DUE_DAY_RANGE_HINT,
  DUE_POLICY_LABEL,
  DUE_POLICY_OPTIONS,
  GROUP_MONTH_FIELD_LABEL,
  JOIN_FEE_POLICY_LABEL,
  JOIN_FEE_POLICY_OPTIONS,
  MONTHLY_FEE_LABEL,
  MONTH_CONFIG_SCOPE_NOTE,
  formatGroupMonthFieldValue,
} from "../../../../lib/group-config-labels";
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
          <Field label={MONTHLY_FEE_LABEL} htmlFor="edit-fee">
            <Input id="edit-fee" type="number" min={0} value={feeAmount} onChange={(e) => { setFeeAmount(e.target.value); markDirty(); }} />
          </Field>
          <Field label={DUE_POLICY_LABEL} htmlFor="edit-duePolicy">
            <Select value={duePolicy} onValueChange={(v) => { setDuePolicy(v as typeof duePolicy); markDirty(); }}>
              <SelectTrigger id="edit-duePolicy"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DUE_POLICY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={DUE_DAY_LABEL} htmlFor="edit-dueDay" hint={`${DUE_DAY_RANGE_HINT} — اختياري`}>
            <Input id="edit-dueDay" type="number" min={1} max={28} value={dueDay} onChange={(e) => { setDueDay(e.target.value); markDirty(); }} />
            <p className="mt-1 text-xs text-text-tertiary">{DUE_DAY_EXPLAINER}</p>
          </Field>
          <Field label={JOIN_FEE_POLICY_LABEL} htmlFor="edit-joinFeePolicy">
            <Select value={joinFeePolicy} onValueChange={(v) => { setJoinFeePolicy(v as typeof joinFeePolicy); markDirty(); }}>
              <SelectTrigger id="edit-joinFeePolicy"><SelectValue /></SelectTrigger>
              <SelectContent>
                {JOIN_FEE_POLICY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        {/* The scope question the owner asked to make explicit: this month, or
            the default from now on? Both — and saying so beats a silent write. */}
        <p className="rounded-md border border-border bg-surface-sunken px-3 py-2.5 text-xs leading-relaxed text-text-secondary">
          {MONTH_CONFIG_SCOPE_NOTE}
        </p>

        {preview ? (
          <div className="rounded-md border border-border bg-surface-sunken p-3 text-sm text-text-secondary">
            {preview.diff.length === 0 ? (
              "لا يوجد تغيير فعلي."
            ) : (
              preview.diff.map((d) => (
                <p key={d.field}>
                  {GROUP_MONTH_FIELD_LABEL[d.field] ?? d.field}: {formatGroupMonthFieldValue(d.field, d.before)} ←{" "}
                  {formatGroupMonthFieldValue(d.field, d.after)}
                </p>
              ))
            )}
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
