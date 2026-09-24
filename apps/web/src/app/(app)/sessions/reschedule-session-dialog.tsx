"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  formatDateTime,
  toast,
} from "@academic-precision/ui";
import type { SessionCalendarItem, SessionReschedulePreviewResponse } from "@academic-precision/contracts";
import { useWorkspace } from "../../../lib/workspace-provider";
import { qk } from "../../../lib/query-keys";
import { previewSessionReschedule, rescheduleSession } from "../../../lib/api/scheduling";

/**
 * Single-session reschedule — preview → confirm, mirroring the two-step
 * `reschedule-preview` + `reschedule` domain flow (the original session
 * becomes RESCHEDULED and a linked RESCHEDULE_REPLACEMENT row is created;
 * history is preserved, never deleted). Only offered for a SCHEDULED
 * session (the same status the backend transaction requires). Online-only
 * per the owner's directive — there is no offline reschedule mutation.
 *
 * `durationMinutes` is carried from the original so the replacement keeps
 * the same length; the teacher only moves the date/time.
 */
export function RescheduleSessionDialog({
  item,
  open,
  onOpenChange,
  onChanged,
}: {
  item: SessionCalendarItem;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged?: () => void;
}) {
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();

  // Default the pickers to the current slot (in the viewer's local zone).
  const initial = toLocalInputs(item.scheduledAt);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [preview, setPreview] = useState<SessionReschedulePreviewResponse | null>(null);

  const reset = () => {
    const a = toLocalInputs(item.scheduledAt);
    setDate(a.date);
    setTime(a.time);
    setPreview(null);
  };

  const proposedIso = date && time ? new Date(`${date}T${time}`).toISOString() : null;

  const previewMutation = useMutation({
    mutationFn: () =>
      previewSessionReschedule(workspaceId!, item.id, {
        scheduledAt: proposedIso!,
        durationMinutes: item.durationMinutes,
      }),
    onSuccess: setPreview,
    onError: () => toast.error("تعذّرت معاينة الموعد الجديد"),
  });

  const confirmMutation = useMutation({
    mutationFn: () => rescheduleSession(workspaceId!, item.id, { previewToken: preview!.previewToken }),
    onSuccess: () => {
      // Every calendar/list/dashboard view derived from sessions must refresh:
      // the original disappears from "current/upcoming", the replacement
      // appears at its new time. A prefix match on `["sessions", ws]`
      // invalidates every session query (list/calendar/detail) at once.
      queryClient.invalidateQueries({ queryKey: ["sessions", workspaceId] });
      queryClient.invalidateQueries({ queryKey: qk.actionCenter.root(workspaceId!) });
      toast.success("تم تغيير موعد الحصة");
      onChanged?.();
      onOpenChange(false);
    },
    onError: () => toast.error("تعذّر تغيير موعد الحصة — أعد المعاينة وحاول مجددًا"),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تغيير موعد الحصة</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-sunken px-4 py-2.5 text-sm">
            <CalendarClock className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
            <span className="text-text-secondary">الموعد الحالي:</span>
            <span className="font-medium text-text-primary">{formatDateTime(item.scheduledAt)}</span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="التاريخ الجديد" htmlFor="reschedule-date">
              <Input id="reschedule-date" type="date" value={date} onChange={(e) => { setDate(e.target.value); setPreview(null); }} />
            </Field>
            <Field label="الوقت الجديد" htmlFor="reschedule-time">
              <Input id="reschedule-time" type="time" value={time} onChange={(e) => { setTime(e.target.value); setPreview(null); }} />
            </Field>
          </div>

          {preview ? (
            <div className="rounded-lg border border-brand/30 bg-brand-subtle/30 p-3 text-sm leading-relaxed text-text-secondary">
              سيتم نقل الحصة من{" "}
              <span className="font-medium text-text-primary">{formatDateTime(item.scheduledAt)}</span> إلى{" "}
              <span className="font-medium text-brand">{formatDateTime(preview.proposed.scheduledAt)}</span>. تبقى الحصة
              القديمة محفوظة في السجل كموعد أُعيد جدولته.
            </div>
          ) : null}
        </div>

        <DialogFooter>
          {preview ? (
            <Button loading={confirmMutation.isPending} onClick={() => confirmMutation.mutate()}>
              تأكيد الموعد الجديد
            </Button>
          ) : (
            <Button
              disabled={!proposedIso}
              loading={previewMutation.isPending}
              onClick={() => previewMutation.mutate()}
            >
              معاينة
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Split a UTC ISO into local `date` (YYYY-MM-DD) + `time` (HH:mm) for the pickers. */
function toLocalInputs(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}
