"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button, Card, ErrorState, LoadingRegion, MetricCell, MetricStrip, toast } from "@academic-precision/ui";
import { completeSession, fetchSessionReview } from "../../../../lib/api/session-mode";
import { qk } from "../../../../lib/query-keys";
import { useWorkspace } from "../../../../lib/workspace-provider";

/**
 * Compact pre-complete review (§19). If the backend's `complete-with-gaps`
 * feature flag is off (current V1 default), `canComplete` will be false
 * whenever real gaps exist — the Complete button is disabled and the
 * backend's own `blockingReasons` are shown verbatim, never invented
 * client-side reasons.
 */
export function ReviewTab({ sessionId, sessionVersion, onCompleted }: { sessionId: string; sessionVersion: number; onCompleted: () => void }) {
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const router = useRouter();

  const query = useQuery({
    queryKey: ["session-review", workspaceId, sessionId],
    queryFn: () => fetchSessionReview(workspaceId!, sessionId),
    enabled: !!workspaceId,
  });

  const completeMutation = useMutation({
    mutationFn: () => completeSession(workspaceId!, sessionId, { version: sessionVersion }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.sessions.detail(workspaceId!, sessionId) });
      toast.success("تم إنهاء الحصة");
      onCompleted();
      router.refresh();
    },
    onError: () => toast.error("تعذّر إنهاء الحصة"),
  });

  if (query.isLoading) return <LoadingRegion />;
  if (query.isError || !query.data) return <ErrorState onRetry={() => query.refetch()} />;

  const review = query.data;

  return (
    <div className="flex flex-col gap-4">
      <MetricStrip columns={review.examSummary.hasExam ? 3 : 2}>
        <MetricCell
          label="الحضور"
          value={review.attendanceSummary.present + review.attendanceSummary.absent + review.attendanceSummary.late}
          sub={review.attendanceSummary.missing > 0 ? `${review.attendanceSummary.missing} ناقص` : "مكتمل"}
          tone={review.attendanceSummary.missing > 0 ? "warning" : "success"}
        />
        <MetricCell
          label="الواجب"
          value={review.homeworkSummary.done + review.homeworkSummary.partial + review.homeworkSummary.notDone + review.homeworkSummary.noHomework}
          sub={review.homeworkSummary.missing > 0 ? `${review.homeworkSummary.missing} ناقص` : "مكتمل"}
          tone={review.homeworkSummary.missing > 0 ? "warning" : "success"}
        />
        {review.examSummary.hasExam ? (
          <MetricCell
            label="الامتحان"
            value={review.examSummary.scored + review.examSummary.absent}
            sub={review.examSummary.missing > 0 ? `${review.examSummary.missing} ناقص` : "مكتمل"}
            tone={review.examSummary.missing > 0 ? "warning" : "success"}
          />
        ) : null}
      </MetricStrip>

      {review.missingRecords.length > 0 ? (
        <Card className="border-warning/30 bg-warning-subtle p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-warning">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            سجلات ناقصة ({review.missingRecords.length})
          </div>
          <ul className="flex flex-col gap-1 text-sm text-text-secondary">
            {review.missingRecords.map((m) => (
              <li key={m.enrollmentId}>
                {m.studentName} — {m.missing.map((t) => (t === "ATTENDANCE" ? "الحضور" : "الواجب")).join(" و ")}
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card className="border-success/30 bg-success-subtle p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-success">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            كل السجلات مكتملة
          </div>
        </Card>
      )}

      {!review.canComplete && review.blockingReasons.length > 0 ? (
        <div className="flex flex-col gap-1">
          {review.blockingReasons.map((reason) => (
            <p key={reason} className="text-sm text-danger">
              {reason}
            </p>
          ))}
        </div>
      ) : null}

      <Button
        size="lg"
        onClick={() => completeMutation.mutate()}
        loading={completeMutation.isPending}
        disabled={!review.canComplete}
        className="w-full sm:w-auto sm:self-end"
      >
        إنهاء الحصة
      </Button>
    </div>
  );
}
