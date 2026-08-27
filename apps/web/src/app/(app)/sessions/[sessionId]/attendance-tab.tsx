"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AttendanceStatus, RosterStudent } from "@academic-precision/contracts";
import { Button, toast } from "@academic-precision/ui";
import { markAllPresent, saveAttendance } from "../../../../lib/api/session-mode";
import { qk } from "../../../../lib/query-keys";
import { useWorkspace } from "../../../../lib/workspace-provider";
import { RosterList, RosterProgress, RosterRow, SegmentedStatus, type StatusOption } from "./session-mode-ui";

const ATTENDANCE_OPTIONS: ReadonlyArray<StatusOption<AttendanceStatus>> = [
  { value: "PRESENT", label: "حاضر", tone: "success" },
  { value: "LATE", label: "متأخر", tone: "warning" },
  { value: "ABSENT", label: "غائب", tone: "danger" },
];

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

  const recorded = students.filter((s) => s.record.attendance).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <RosterProgress recorded={recorded} total={students.length} />
        </div>
        <Button size="sm" variant="outline" onClick={() => markAllMutation.mutate()} loading={markAllMutation.isPending} className="shrink-0">
          الكل حاضر
        </Button>
      </div>

      <RosterList>
        {students.map((s, i) => (
          <RosterRow key={s.enrollmentId} index={i + 1} name={s.studentName} saving={savingId === s.enrollmentId}>
            <SegmentedStatus
              aria-label={`حضور ${s.studentName}`}
              options={ATTENDANCE_OPTIONS}
              value={s.record.attendance}
              disabled={savingId === s.enrollmentId}
              onChange={(status) => setOneMutation.mutate({ enrollmentId: s.enrollmentId, status })}
            />
          </RosterRow>
        ))}
      </RosterList>
    </div>
  );
}
