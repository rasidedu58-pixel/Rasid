"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AttendanceStatus, RosterStudent } from "@academic-precision/contracts";
import { Button, toast } from "@academic-precision/ui";
import { markAllPresent, saveAttendance } from "../../../../lib/api/session-mode";
import { qk } from "../../../../lib/query-keys";
import { useWorkspace } from "../../../../lib/workspace-provider";

const STATUS_LABEL: Record<AttendanceStatus, string> = { PRESENT: "حاضر", ABSENT: "غائب", LATE: "متأخر" };
const STATUS_TONE: Record<AttendanceStatus, string> = {
  PRESENT: "border-success bg-success-subtle text-success",
  ABSENT: "border-danger bg-danger-subtle text-danger",
  LATE: "border-warning bg-warning-subtle text-warning",
};

/**
 * Fast attendance entry (§16): bulk "الكل حاضر" first, then per-student
 * exceptions with one tap each — never 30 individual dropdown selections.
 * Each tap saves immediately (one PUT per change is still far fewer
 * requests than per-keystroke, and gives the teacher real, visible save
 * state rather than a single easy-to-lose "save all" at the end).
 */
export function AttendanceTab({ sessionId, sessionVersion, students }: { sessionId: string; sessionVersion: number; students: RosterStudent[] }) {
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const [savingId, setSavingId] = useState<string | null>(null);

  const markAllMutation = useMutation({
    mutationFn: () => markAllPresent(workspaceId!, sessionId, { sessionVersion }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.sessions.roster(workspaceId!, sessionId) });
      toast.success("تم تسجيل الجميع كحاضرين");
    },
    onError: () => toast.error("تعذّر الحفظ"),
  });

  const setOneMutation = useMutation({
    mutationFn: (v: { enrollmentId: string; status: AttendanceStatus }) => saveAttendance(workspaceId!, sessionId, { sessionVersion, records: [{ enrollmentId: v.enrollmentId, status: v.status }] }),
    onMutate: (v) => setSavingId(v.enrollmentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.sessions.roster(workspaceId!, sessionId) }),
    onError: () => toast.error("تعذّر حفظ الحضور"),
    onSettled: () => setSavingId(null),
  });

  const unrecorded = students.filter((s) => !s.record.attendance).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-secondary">{unrecorded > 0 ? `${unrecorded} من ${students.length} لم يُسجّل بعد` : `تم تسجيل الجميع (${students.length})`}</p>
        <Button size="sm" variant="outline" onClick={() => markAllMutation.mutate()} loading={markAllMutation.isPending}>
          الكل حاضر
        </Button>
      </div>

      <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {students.map((s) => (
          <div key={s.enrollmentId} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="text-sm font-medium text-text-primary">{s.studentName}</span>
            <div className="flex gap-1.5">
              {(["PRESENT", "LATE", "ABSENT"] as AttendanceStatus[]).map((status) => (
                <button
                  key={status}
                  type="button"
                  disabled={savingId === s.enrollmentId}
                  onClick={() => setOneMutation.mutate({ enrollmentId: s.enrollmentId, status })}
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${s.record.attendance === status ? STATUS_TONE[status] : "border-border text-text-secondary hover:bg-surface-sunken"}`}
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
