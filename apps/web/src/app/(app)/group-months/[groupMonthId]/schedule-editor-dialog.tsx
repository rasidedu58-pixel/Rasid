"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ScheduleRule, SchedulePreviewResponse } from "@academic-precision/contracts";
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, formatDateTime, toast } from "@academic-precision/ui";
import { Plus, X } from "lucide-react";
import { previewSchedule, applySchedule } from "../../../../lib/api/scheduling";
import { qk } from "../../../../lib/query-keys";
import { useWorkspace } from "../../../../lib/workspace-provider";

const WEEKDAY_LABELS = ["الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"];

interface RuleDraft {
  weekday: number;
  startTime: string;
  durationMinutes: string;
}

function toDraft(rules: ScheduleRule[]): RuleDraft[] {
  return rules.map((r) => ({ weekday: r.weekday, startTime: r.startTime.slice(0, 5), durationMinutes: String(r.durationMinutes) }));
}

/**
 * Change a GroupMonth's weekly schedule — same preview/apply-token pattern
 * as everywhere else. Also the ONLY path to give a carried-forward or
 * newly-created-with-no-rules GroupMonth its FIRST schedule (the backend
 * doc comment on `schedule/preview` says this explicitly — see the
 * scheduling contract).
 */
export function ScheduleEditorDialog({ groupMonthId, currentRules, open, onOpenChange }: { groupMonthId: string; currentRules: ScheduleRule[]; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const [rules, setRules] = useState<RuleDraft[]>(() => toDraft(currentRules));
  const [preview, setPreview] = useState<SchedulePreviewResponse | null>(null);

  function update(index: number, patch: Partial<RuleDraft>) {
    setRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    setPreview(null);
  }
  function remove(index: number) {
    setRules((prev) => prev.filter((_, i) => i !== index));
    setPreview(null);
  }
  function add() {
    setRules((prev) => [...prev, { weekday: 0, startTime: "16:00", durationMinutes: "60" }]);
    setPreview(null);
  }

  const previewMutation = useMutation({
    mutationFn: () =>
      previewSchedule(workspaceId!, groupMonthId, {
        rules: rules.map((r) => ({ weekday: r.weekday, startTime: r.startTime, durationMinutes: Number(r.durationMinutes) || 60 })),
      }),
    onSuccess: setPreview,
    onError: () => toast.error("تعذّرت معاينة الجدول"),
  });

  const applyMutation = useMutation({
    mutationFn: () => applySchedule(workspaceId!, groupMonthId, { previewToken: preview!.previewToken }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.groups.schedule(workspaceId!, groupMonthId) });
      queryClient.invalidateQueries({ queryKey: qk.sessions.list(workspaceId!, { groupMonthId }) });
      toast.success("تم تحديث الجدول");
      onOpenChange(false);
    },
    onError: () => toast.error("تعذّر تطبيق الجدول — حاول المعاينة مرة أخرى"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تعديل الجدول الأسبوعي</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {rules.map((rule, index) => (
            <div key={index} className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
              <Select value={String(rule.weekday)} onValueChange={(v) => update(index, { weekday: Number(v) })}>
                <SelectTrigger className="min-w-32 flex-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WEEKDAY_LABELS.map((label, day) => (
                    <SelectItem key={day} value={String(day)}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input type="time" value={rule.startTime} onChange={(e) => update(index, { startTime: e.target.value })} className="w-32" />
              <Input type="number" min={5} value={rule.durationMinutes} onChange={(e) => update(index, { durationMinutes: e.target.value })} className="w-24" />
              <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} aria-label="حذف">
                <X className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={add} className="self-start">
            <Plus className="h-4 w-4" aria-hidden />
            إضافة موعد
          </Button>
        </div>

        {preview ? (
          <div className="flex flex-col gap-1 rounded-md border border-border bg-surface-sunken p-3 text-xs text-text-secondary">
            {preview.toAdd.length > 0 ? <p>سيُنشأ {preview.toAdd.length} حصة جديدة.</p> : null}
            {preview.toRemove.length > 0 ? <p>سيُلغى {preview.toRemove.length} حصة قادمة: {preview.toRemove.map((s) => formatDateTime(s.scheduledAt)).join("، ")}</p> : null}
            {preview.unchanged.length > 0 ? <p>{preview.unchanged.length} حصة بدون تغيير.</p> : null}
            {preview.toAdd.length === 0 && preview.toRemove.length === 0 ? <p>لا يوجد تغيير فعلي.</p> : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" loading={previewMutation.isPending} onClick={() => previewMutation.mutate()}>
            معاينة
          </Button>
          <Button disabled={!preview} loading={applyMutation.isPending} onClick={() => applyMutation.mutate()}>
            تطبيق
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
