"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { RosterStudent } from "@academic-precision/contracts";
import { Button, Field, Input, Switch, toast } from "@academic-precision/ui";
import { defineExam, saveExamScores } from "../../../../lib/api/session-mode";
import { useWorkspace } from "../../../../lib/workspace-provider";
import { qk } from "../../../../lib/query-keys";

/**
 * Exam is optional per session (§18). Absent-from-exam and score=0 are
 * DISTINCT states, never merged — a dedicated "غياب عن الامتحان" toggle
 * per student prevents a 0 ever being typed to mean "didn't attend".
 *
 * Backend note: there is no GET endpoint for exam definition (only
 * PUT .../exam to define, PUT .../exam/scores to score) — `hasExam` comes
 * from the Review endpoint's own `examSummary.hasExam` (the one place
 * that IS derived server-side), passed down from the parent page rather
 * than re-fetched here. Re-editing an already-defined exam's name/max
 * score is out of this screen's scope for the same reason (no read-back
 * of its current version to submit a safe concurrent update) — documented
 * as a known Phase 11 limitation, not silently guessed.
 */
export function ExamTab({ sessionId, sessionVersion, students, hasExam }: { sessionId: string; sessionVersion: number; students: RosterStudent[]; hasExam: boolean }) {
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();

  const [examDefined, setExamDefined] = useState(hasExam);
  const [examName, setExamName] = useState("");
  const [maxScore, setMaxScore] = useState("");
  const [scores, setScores] = useState<Record<string, { absent: boolean; score: string }>>({});

  const defineMutation = useMutation({
    mutationFn: () => defineExam(workspaceId!, sessionId, { hasExam: true, name: examName || "امتحان", maxScore: Number(maxScore) }),
    onSuccess: () => {
      setExamDefined(true);
      toast.success("تم تحديد الامتحان");
    },
    onError: () => toast.error("تعذّر حفظ إعداد الامتحان"),
  });

  const scoresMutation = useMutation({
    mutationFn: () =>
      saveExamScores(workspaceId!, sessionId, {
        sessionVersion,
        records: students
          .filter((s) => scores[s.enrollmentId])
          .map((s) => {
            const entry = scores[s.enrollmentId]!;
            return entry.absent ? { enrollmentId: s.enrollmentId, status: "ABSENT_FROM_EXAM" as const } : { enrollmentId: s.enrollmentId, status: "SCORED" as const, score: Number(entry.score) || 0 };
          }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.sessions.roster(workspaceId!, sessionId) });
      toast.success("تم حفظ الدرجات");
    },
    onError: () => toast.error("تعذّر حفظ الدرجات"),
  });

  if (!examDefined) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border py-10 text-center">
        <p className="text-sm text-text-secondary">لا يوجد امتحان مسجّل لهذه الحصة.</p>
        <div className="flex w-full max-w-xs flex-col gap-3">
          <Field label="اسم الامتحان" htmlFor="examName">
            <Input id="examName" value={examName} onChange={(e) => setExamName(e.target.value)} placeholder="امتحان الوحدة الأولى" />
          </Field>
          <Field label="الدرجة الكاملة" htmlFor="maxScore">
            <Input id="maxScore" type="number" min="1" dir="ltr" value={maxScore} onChange={(e) => setMaxScore(e.target.value)} />
          </Field>
          <Button onClick={() => defineMutation.mutate()} loading={defineMutation.isPending} disabled={!maxScore}>
            إضافة امتحان لهذه الحصة
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {examName ? <p className="text-sm text-text-secondary">{examName} — من {maxScore}</p> : null}
      <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {students.map((s) => {
          const local = scores[s.enrollmentId] ?? { absent: s.record.examStatus === "ABSENT_FROM_EXAM", score: s.record.examScore !== null ? String(s.record.examScore) : "" };
          return (
            <div key={s.enrollmentId} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-sm font-medium text-text-primary">{s.studentName}</span>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                  <Switch checked={local.absent} onCheckedChange={(v) => setScores((prev) => ({ ...prev, [s.enrollmentId]: { ...local, absent: v } }))} />
                  غياب عن الامتحان
                </label>
                <Input
                  type="number"
                  min="0"
                  dir="ltr"
                  disabled={local.absent}
                  value={local.score}
                  onChange={(e) => setScores((prev) => ({ ...prev, [s.enrollmentId]: { ...local, score: e.target.value } }))}
                  className="w-20"
                />
              </div>
            </div>
          );
        })}
      </div>
      <Button onClick={() => scoresMutation.mutate()} loading={scoresMutation.isPending} disabled={Object.keys(scores).length === 0} className="self-end">
        حفظ الدرجات
      </Button>
    </div>
  );
}
