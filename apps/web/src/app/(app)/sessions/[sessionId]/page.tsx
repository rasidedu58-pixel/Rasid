"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, PlayCircle } from "lucide-react";
import { Badge, Button, Card, ErrorState, LoadingRegion, Tabs, TabsContent, TabsList, TabsTrigger, formatDateTime, toast } from "@academic-precision/ui";
import { PageHeader } from "../../../../components/shell/page-header";
import { useWorkspace } from "../../../../lib/workspace-provider";
import { qk } from "../../../../lib/query-keys";
import { fetchSession } from "../../../../lib/api/scheduling";
import { fetchSessionRoster, fetchSessionReview, startSession } from "../../../../lib/api/session-mode";
import { AttendanceTab } from "./attendance-tab";
import { HomeworkTab } from "./homework-tab";
import { ExamTab } from "./exam-tab";
import { ReviewTab } from "./review-tab";

const STATUS_LABEL: Record<string, string> = {
  SCHEDULED: "مجدولة",
  IN_PROGRESS: "جارية",
  COMPLETED: "مكتملة",
  CANCELLED: "ملغاة",
  RESCHEDULED: "مؤجّلة",
};

/**
 * Session Mode — the Golden Flow (§15): Start -> Attendance -> Homework ->
 * Exam (optional) -> Review -> Complete, all on ONE page via tabs, not a
 * 7-screen wizard. A SCHEDULED session shows only a Start action; once
 * IN_PROGRESS the full roster-driven tabs unlock; a COMPLETED/CANCELLED/
 * RESCHEDULED session renders read-only (no Session Mode tabs at all).
 */
export default function SessionModePage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("attendance");

  const sessionQuery = useQuery({
    queryKey: workspaceId ? qk.sessions.detail(workspaceId, sessionId) : ["session", "none"],
    queryFn: () => fetchSession(workspaceId!, sessionId),
    enabled: !!workspaceId,
  });

  const isInProgress = sessionQuery.data?.status === "IN_PROGRESS";

  const rosterQuery = useQuery({
    queryKey: workspaceId ? qk.sessions.roster(workspaceId, sessionId) : ["roster", "none"],
    queryFn: () => fetchSessionRoster(workspaceId!, sessionId),
    enabled: !!workspaceId && isInProgress,
  });

  const reviewQuery = useQuery({
    queryKey: ["session-review", workspaceId, sessionId],
    queryFn: () => fetchSessionReview(workspaceId!, sessionId),
    enabled: !!workspaceId && isInProgress,
  });

  const startMutation = useMutation({
    mutationFn: () => startSession(workspaceId!, sessionId, { version: sessionQuery.data!.version }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.sessions.detail(workspaceId!, sessionId) });
      toast.success("تم بدء الحصة");
    },
    onError: () => toast.error("تعذّر بدء الحصة"),
  });

  if (sessionQuery.isLoading) return <LoadingRegion className="min-h-[60vh]" />;
  if (sessionQuery.isError || !sessionQuery.data) return <ErrorState onRetry={() => sessionQuery.refetch()} />;

  const session = sessionQuery.data;

  return (
    <>
      <PageHeader
        title="وضع الحصة"
        description={formatDateTime(session.scheduledAt)}
        actions={<Badge tone={session.status === "IN_PROGRESS" ? "brand" : session.status === "COMPLETED" ? "success" : "neutral"}>{STATUS_LABEL[session.status] ?? session.status}</Badge>}
      />

      {session.status === "SCHEDULED" ? (
        <Card className="flex flex-col items-center gap-4 p-10 text-center">
          <CalendarClock className="h-10 w-10 text-brand" aria-hidden />
          <div>
            <p className="font-medium text-text-primary">هذه الحصة لم تبدأ بعد</p>
            <p className="text-sm text-text-secondary">ابدأ الحصة لتسجيل الحضور والواجب.</p>
          </div>
          <Button size="lg" onClick={() => startMutation.mutate()} loading={startMutation.isPending}>
            <PlayCircle className="h-4 w-4" aria-hidden />
            بدء الحصة
          </Button>
        </Card>
      ) : session.status === "IN_PROGRESS" ? (
        rosterQuery.isLoading ? (
          <LoadingRegion />
        ) : rosterQuery.isError || !rosterQuery.data ? (
          <ErrorState onRetry={() => rosterQuery.refetch()} />
        ) : (
          <Tabs value={tab} onValueChange={setTab} dir="rtl">
            <TabsList>
              <TabsTrigger value="attendance">الحضور</TabsTrigger>
              <TabsTrigger value="homework">الواجب</TabsTrigger>
              <TabsTrigger value="exam">الامتحان</TabsTrigger>
              <TabsTrigger value="review">مراجعة وإنهاء</TabsTrigger>
            </TabsList>
            <TabsContent value="attendance">
              <AttendanceTab sessionId={sessionId} sessionVersion={rosterQuery.data.session.version} students={rosterQuery.data.students} />
            </TabsContent>
            <TabsContent value="homework">
              <HomeworkTab sessionId={sessionId} sessionVersion={rosterQuery.data.session.version} students={rosterQuery.data.students} />
            </TabsContent>
            <TabsContent value="exam">
              <ExamTab sessionId={sessionId} sessionVersion={rosterQuery.data.session.version} students={rosterQuery.data.students} hasExam={reviewQuery.data?.examSummary.hasExam ?? false} />
            </TabsContent>
            <TabsContent value="review">
              <ReviewTab sessionId={sessionId} sessionVersion={rosterQuery.data.session.version} onCompleted={() => sessionQuery.refetch()} />
            </TabsContent>
          </Tabs>
        )
      ) : (
        <Card className="p-6 text-center text-sm text-text-secondary">
          {session.status === "COMPLETED" ? "تم إنهاء هذه الحصة." : session.status === "CANCELLED" ? "تم إلغاء هذه الحصة." : "تم تأجيل هذه الحصة إلى موعد آخر."}
        </Card>
      )}
    </>
  );
}
