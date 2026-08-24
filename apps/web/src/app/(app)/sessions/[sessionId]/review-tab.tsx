"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Badge, Button, Card, ErrorState, LoadingRegion, toast } from "@academic-precision/ui";
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ReviewStat label="الحضور" value={`${review.attendanceSummary.present + review.attendanceSummary.absent + review.attendanceSummary.late}`} missing={review.attendanceSummary.missing} />
        <ReviewStat label="الواجب" value={`${review.homeworkSummary.done + review.homeworkSummary.partial + review.homeworkSummary.notDone + review.homeworkSummary.noHomework}`} missing={review.homeworkSummary.missing} />
        {review.examSummary.hasExam ? <ReviewStat label="الامتحان" value={`${review.examSummary.scored + review.examSummary.absent}`} missing={review.examSummary.missing} /> : null}
      </div>

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

      <Button onClick={() => completeMutation.mutate()} loading={completeMutation.isPending} disabled={!review.canComplete} className="self-end">
        إنهاء الحصة
      </Button>
    </div>
  );
}

function ReviewStat({ label, value, missing }: { label: string; value: string; missing: number }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-text-secondary">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-lg font-semibold tabular-nums text-text-primary">{value}</span>
        {missing > 0 ? <Badge tone="warning">{missing} ناقص</Badge> : null}
      </div>
    </Card>
  );
}
