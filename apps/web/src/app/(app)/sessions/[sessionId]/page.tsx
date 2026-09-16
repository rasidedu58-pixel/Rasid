"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, PlayCircle } from "lucide-react";
import { Badge, Button, Card, ErrorState, LoadingRegion, Tabs, TabsContent, TabsList, TabsTrigger, formatDateTime, toast } from "@academic-precision/ui";
import { PageHeader } from "../../../../components/shell/page-header";
import { useWorkspace } from "../../../../lib/workspace-provider";
import { qk } from "../../../../lib/query-keys";
import { fetchSessionReview, startSession } from "../../../../lib/api/session-mode";
import { useSessionDetailQuery, useSessionRosterQuery } from "../../../../offline/runtime/queries";
import { useSessionWrites } from "../../../../offline/runtime/use-session-writes";
import { SyncStatusBadge } from "../../../../offline/components/sync-status-badge";
import { deriveSessionDisplay } from "../session-status";
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

  // Local-first when the offline layer is on; identical online-only fetch when off.
  const sessionQuery = useSessionDetailQuery(workspaceId ?? undefined, sessionId);
  const writes = useSessionWrites(sessionId);

  const isInProgress = sessionQuery.data?.status === "IN_PROGRESS";

  // Live-ticking "now" so the missed-session banner + labels react to the
  // exact slot boundary while the teacher has the page open (owner
  // directive, Phase 9). Kept lightweight — one 30-second interval — and
  // scoped to the mounted page.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const rosterQuery = useSessionRosterQuery(workspaceId ?? undefined, sessionId, isInProgress);

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

  // Derived display state (`sessions/session-status.ts`) — treats a
  // SCHEDULED-past-end OR IN_PROGRESS-past-end row as `missed`. Used ONLY
  // to adjust the copy on the pre-recording card; the underlying write
  // path is unchanged (SCHEDULED → /start then record, IN_PROGRESS →
  // record directly), so the teacher's `scheduledAt` never mutates and
  // no duplicate attendance can be introduced. `durationMinutes` is
  // required on the `Session` contract (`packages/contracts/src/
  // scheduling.ts`), so no fabricated fallback is needed here.
  const display = deriveSessionDisplay(
    { status: session.status, scheduledAt: session.scheduledAt, durationMinutes: session.durationMinutes },
    now,
  );
  const isMissed = display.key === "missed";

  return (
    <>
      <PageHeader
        title="وضع الحصة"
        description={formatDateTime(session.scheduledAt)}
        actions={
          <div className="flex items-center gap-3">
            <SyncStatusBadge />
            <Badge tone={isMissed ? "warning" : session.status === "IN_PROGRESS" ? "brand" : session.status === "COMPLETED" ? "success" : "neutral"}>
              {isMissed ? "فائتة — لم تُسجَّل" : STATUS_LABEL[session.status] ?? session.status}
            </Badge>
          </div>
        }
      />

      {session.status === "SCHEDULED" ? (
        <Card className="flex flex-col items-center gap-4 p-10 text-center">
          <CalendarClock className="h-10 w-10 text-brand" aria-hidden />
          <div>
            <p className="font-medium text-text-primary">
              {isMissed ? "هذه الحصة انتهى وقتها ولم تُسجَّل بعد" : "هذه الحصة لم تبدأ بعد"}
            </p>
            <p className="text-sm text-text-secondary">
              {isMissed
                ? "يمكنك تسجيلها الآن دون تغيير موعدها الأصلي — يبقى الموعد كما هو، وتُحفَظ بيانات التسجيل بوقتها الفعلي."
                : "ابدأ الحصة لتسجيل الحضور والواجب."}
            </p>
          </div>
          <Button
            size="lg"
            onClick={() => (writes.active ? void writes.start().catch(() => toast.error("تعذّر بدء الحصة محليًا")) : startMutation.mutate())}
            loading={startMutation.isPending}
          >
            <PlayCircle className="h-4 w-4" aria-hidden />
            {isMissed ? "تسجيل الحصة الآن" : "بدء الحصة"}
          </Button>
        </Card>
      ) : session.status === "IN_PROGRESS" ? (
        rosterQuery.isLoading ? (
          <LoadingRegion />
        ) : rosterQuery.isError || !rosterQuery.data ? (
          <ErrorState onRetry={() => rosterQuery.refetch()} />
        ) : (
          <>
            {isMissed ? (
              // A stored-IN_PROGRESS session whose slot ended has TWO
              // possible histories, and the banner copy owner-directed
              // (Phase 15, section 3) must reflect the real one — not
              // assume the teacher recorded anything they did not:
              //
              //   (a) The teacher tapped Start and recorded at least one
              //       row before the slot ran out. `reviewQuery` is
              //       already fetched for the review tab (no extra
              //       round-trip), and its `attendanceSummary.present +
              //       absent + late > 0` proves saved data exists. Copy:
              //       «لديك تسجيلات محفوظة لهذه الحصة. يمكنك استكمال
              //       البيانات الناقصة.»
              //   (b) The teacher tapped Start but recorded nothing —
              //       count is 0. Copy is a neutral late-record invite:
              //       «انتهى موعد الحصة قبل إكمالها. يمكنك تسجيل بياناتها
              //       الآن.»
              //
              // The stored `session_records` rows are NEVER mutated here
              // (nothing calls a write path), the DB status stays
              // IN_PROGRESS, and `canComplete` conditions are unchanged.
              // No auto-complete on this render.
              (() => {
                const a = reviewQuery.data?.attendanceSummary;
                const hasSavedData = a ? a.present + a.absent + a.late > 0 : false;
                return (
                  <div className="mb-4 rounded-xl border border-warning/40 bg-warning-subtle/30 p-4 text-sm">
                    <p className="font-semibold text-warning">فائتة — لم تُسجَّل بالكامل</p>
                    <p className="mt-1 leading-relaxed text-text-secondary">
                      {hasSavedData
                        ? "لديك تسجيلات محفوظة لهذه الحصة. يمكنك استكمال البيانات الناقصة من التبويبات أدناه، ثم الضغط على «مراجعة وإنهاء» عندما تكون جاهزًا — الموعد الأصلي للحصة لا يتغيّر."
                        : "انتهى موعد الحصة قبل إكمالها. يمكنك تسجيل بياناتها الآن من التبويبات أدناه — الموعد الأصلي للحصة لا يتغيّر."}
                    </p>
                  </div>
                );
              })()
            ) : null}
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
          </>
        )
      ) : (
        <Card className="p-6 text-center text-sm text-text-secondary">
          {session.status === "COMPLETED" ? "تم إنهاء هذه الحصة." : session.status === "CANCELLED" ? "تم إلغاء هذه الحصة." : "تم تأجيل هذه الحصة إلى موعد آخر."}
        </Card>
      )}
    </>
  );
}
