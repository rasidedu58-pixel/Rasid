"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { HomeworkStatus, RosterStudent } from "@academic-precision/contracts";
import { Button, toast } from "@academic-precision/ui";
import { markAllHomeworkDone, markNoHomework, saveHomework } from "../../../../lib/api/session-mode";
import { qk } from "../../../../lib/query-keys";
import { useWorkspace } from "../../../../lib/workspace-provider";

const STATUS_LABEL: Record<HomeworkStatus, string> = { DONE: "منجز", PARTIAL: "جزئي", NOT_DONE: "غير منجز", NO_HOMEWORK: "لا يوجد واجب" };
const STATUS_TONE: Record<HomeworkStatus, string> = {
  DONE: "border-success bg-success-subtle text-success",
  PARTIAL: "border-warning bg-warning-subtle text-warning",
  NOT_DONE: "border-danger bg-danger-subtle text-danger",
  NO_HOMEWORK: "border-text-tertiary bg-surface-sunken text-text-secondary",
};

/** §17: absence never implies "no homework" — homework recording is fully independent of attendance status, and the UI never assumes one from the other. */
export function HomeworkTab({ sessionId, sessionVersion, students }: { sessionId: string; sessionVersion: number; students: RosterStudent[] }) {
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const [savingId, setSavingId] = useState<string | null>(null);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.sessions.roster(workspaceId!, sessionId) });

  const markAllDoneMutation = useMutation({
    mutationFn: () => markAllHomeworkDone(workspaceId!, sessionId, { sessionVersion }),
    onSuccess: () => { invalidate(); toast.success("تم تسجيل الواجب كمنجز للجميع"); },
    onError: () => toast.error("تعذّر الحفظ"),
  });
  const noHomeworkMutation = useMutation({
    mutationFn: () => markNoHomework(workspaceId!, sessionId, { sessionVersion }),
    onSuccess: () => { invalidate(); toast.success("تم تسجيل عدم وجود واجب"); },
    onError: () => toast.error("تعذّر الحفظ"),
  });
  const setOneMutation = useMutation({
    mutationFn: (v: { enrollmentId: string; status: HomeworkStatus }) => saveHomework(workspaceId!, sessionId, { sessionVersion, records: [{ enrollmentId: v.enrollmentId, status: v.status }] }),
    onMutate: (v) => setSavingId(v.enrollmentId),
    onSuccess: invalidate,
    onError: () => toast.error("تعذّر حفظ الواجب"),
    onSettled: () => setSavingId(null),
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => noHomeworkMutation.mutate()} loading={noHomeworkMutation.isPending}>
          لا يوجد واجب لهذه الحصة
        </Button>
        <Button size="sm" variant="outline" onClick={() => markAllDoneMutation.mutate()} loading={markAllDoneMutation.isPending}>
          الكل منجز
        </Button>
      </div>

      <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {students.map((s) => (
          <div key={s.enrollmentId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <span className="text-sm font-medium text-text-primary">{s.studentName}</span>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(STATUS_LABEL) as HomeworkStatus[]).map((status) => (
                <button
                  key={status}
                  type="button"
                  disabled={savingId === s.enrollmentId}
                  onClick={() => setOneMutation.mutate({ enrollmentId: s.enrollmentId, status })}
                  className={`min-w-12 rounded-md border px-2.5 py-2 text-xs font-medium transition-colors disabled:opacity-50 ${s.record.homework === status ? STATUS_TONE[status] : "border-border text-text-secondary hover:bg-surface-sunken"}`}
                >
                  {STATUS_LABEL[status]}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
