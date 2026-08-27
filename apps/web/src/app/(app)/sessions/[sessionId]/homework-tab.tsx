"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { HomeworkStatus, RosterStudent } from "@academic-precision/contracts";
import { Button, toast } from "@academic-precision/ui";
import { markAllHomeworkDone, markNoHomework, saveHomework } from "../../../../lib/api/session-mode";
import { qk } from "../../../../lib/query-keys";
import { useWorkspace } from "../../../../lib/workspace-provider";
import { RosterList, RosterProgress, RosterRow, SegmentedStatus, type StatusOption } from "./session-mode-ui";

const HOMEWORK_OPTIONS: ReadonlyArray<StatusOption<HomeworkStatus>> = [
  { value: "DONE", label: "منجز", tone: "success" },
  { value: "PARTIAL", label: "جزئي", tone: "warning" },
  { value: "NOT_DONE", label: "غير منجز", tone: "danger" },
  { value: "NO_HOMEWORK", label: "لا واجب", tone: "neutral" },
];

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

  const recorded = students.filter((s) => s.record.homework).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <RosterProgress recorded={recorded} total={students.length} />
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" onClick={() => noHomeworkMutation.mutate()} loading={noHomeworkMutation.isPending}>
            لا يوجد واجب
          </Button>
          <Button size="sm" variant="outline" onClick={() => markAllDoneMutation.mutate()} loading={markAllDoneMutation.isPending}>
            الكل منجز
          </Button>
        </div>
      </div>

      <RosterList>
        {students.map((s, i) => (
          <RosterRow key={s.enrollmentId} index={i + 1} name={s.studentName} saving={savingId === s.enrollmentId}>
            <SegmentedStatus
              aria-label={`واجب ${s.studentName}`}
              options={HOMEWORK_OPTIONS}
              value={s.record.homework}
              disabled={savingId === s.enrollmentId}
              onChange={(status) => setOneMutation.mutate({ enrollmentId: s.enrollmentId, status })}
            />
          </RosterRow>
        ))}
      </RosterList>
    </div>
  );
}
