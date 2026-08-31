"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CalendarRange, Plus } from "lucide-react";
import { Badge, Button, Card, CardContent, EmptyState, ErrorState, LoadingRegion, formatDate, formatMonthLabel, toast } from "@academic-precision/ui";
import { PageHeader } from "../../../components/shell/page-header";
import { useWorkspace } from "../../../lib/workspace-provider";
import { qk } from "../../../lib/query-keys";
import { activateMonth, fetchMonthPrepEligibility, fetchMonths } from "../../../lib/api/scheduling";

/**
 * Operating Months — Phase 11 Closure Delta. The entry point that closes
 * the real blocker found in live QA: a fresh Teacher Workspace had no UI
 * path to reach `POST /months`/`POST /months/preview` (both already
 * existed on the backend, unused by any page). Month creation itself is
 * Owner-only server-side (`SchedulingService.assertOwner`) — the "شهر
 * جديد" action is hidden for non-owners rather than shown and then
 * rejected.
 */
export default function MonthsPage() {
  const { workspaceId, isOwner } = useWorkspace();
  const query = useQuery({
    queryKey: workspaceId ? qk.months.list(workspaceId) : ["months", "none"],
    queryFn: () => fetchMonths(workspaceId!),
    enabled: !!workspaceId,
  });
  // Entitlement-aware: if CREATE_MONTH isn't available, never show an active
  // prepare CTA (the server would reject it anyway).
  const prep = useQuery({
    queryKey: workspaceId ? qk.months.prepEligibility(workspaceId) : ["months", "prep", "none"],
    queryFn: () => fetchMonthPrepEligibility(workspaceId!),
    enabled: !!workspaceId && isOwner,
  });
  const entitlementBlocked = prep.data?.blockedReason === "ENTITLEMENT_REQUIRED";
  const canShowPrepCta = isOwner && !entitlementBlocked;

  if (query.isLoading) {
    return (
      <>
        <PageHeader title="الأشهر التشغيلية" />
        <LoadingRegion />
      </>
    );
  }

  if (query.isError || !query.data) {
    return (
      <>
        <PageHeader title="الأشهر التشغيلية" />
        <ErrorState onRetry={() => query.refetch()} />
      </>
    );
  }

  const months = [...query.data.months].sort((a, b) => b.year - a.year || b.month - a.month);
  const current = months.find((m) => m.status === "CURRENT");
  const history = months.filter((m) => m.status === "ARCHIVED");

  return (
    <>
      <PageHeader
        title="الأشهر التشغيلية"
        description="الشهر التشغيلي يحدد المجموعات النشطة ورسومها وجدولها لهذا الشهر."
        actions={
          canShowPrepCta ? (
            <Button asChild size="sm">
              <Link href="/months/new">
                <Plus className="h-4 w-4" aria-hidden />
                {current ? "شهر جديد" : "تجهيز أول شهر تشغيلي"}
              </Link>
            </Button>
          ) : undefined
        }
      />

      {entitlementBlocked ? (
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-text-primary">
          يلزم تجديد الاشتراك لبدء شهر تشغيلي جديد.
        </p>
      ) : null}

      {months.length === 0 ? (
        <EmptyState
          icon={<CalendarRange className="h-8 w-8 text-text-tertiary" aria-hidden />}
          title="لا يوجد شهر تشغيلي بعد"
          description={
            isOwner
              ? "قبل أن تبدأ في جدولة الحصص وتسجيل الطلاب، جهّز أول شهر تشغيلي — سيحدد المجموعات النشطة ورسومها وجدولها."
              : "بانتظار مالك المساحة لتجهيز أول شهر تشغيلي."
          }
          action={
            canShowPrepCta ? (
              <Button asChild size="sm">
                <Link href="/months/new">تجهيز أول شهر تشغيلي</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          {current ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-text-secondary">الشهر الحالي</h2>
              <Link href={`/months/${current.id}`}>
                <Card className="transition-shadow hover:shadow-sm">
                  <CardContent className="flex items-center justify-between py-4">
                    <span className="font-medium text-text-primary">{formatMonthLabel(current.year, current.month)}</span>
                    <Badge tone="success">حالي</Badge>
                  </CardContent>
                </Card>
              </Link>
            </section>
          ) : null}

          {isOwner && workspaceId ? <NextMonthPrep workspaceId={workspaceId} /> : null}

          {history.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-text-secondary">أشهر سابقة</h2>
              <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {history.map((m) => (
                  <Link key={m.id} href={`/months/${m.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-surface-sunken">
                    <span className="text-sm text-text-primary">{formatMonthLabel(m.year, m.month)}</span>
                    <Badge tone="neutral">مؤرشف</Badge>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </>
  );
}

/**
 * Next-month PREPARE / ACTIVATE surface (Owner-only). Shows the prepared DRAFT
 * with a "start" action once its month has begun, or when the natural prep
 * window opens. The server enforces every rule — this only surfaces state.
 */
function NextMonthPrep({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: qk.months.prepEligibility(workspaceId),
    queryFn: () => fetchMonthPrepEligibility(workspaceId),
  });
  const activate = useMutation({
    mutationFn: (monthId: string) => activateMonth(workspaceId, monthId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.months.list(workspaceId) });
      queryClient.invalidateQueries({ queryKey: qk.months.prepEligibility(workspaceId) });
      toast.success("تم بدء الشهر الجديد");
    },
    onError: () => toast.error("تعذّر بدء الشهر — تأكد أن الشهر قد بدأ فعلًا"),
  });

  const data = query.data;
  if (!data || !data.current) return null;

  // Entitlement required — never offer prepare/activate, show the renewal note
  // (the header already surfaces it too; the server guard is the real gate).
  if (data.blockedReason === "ENTITLEMENT_REQUIRED") return null;

  // A DRAFT is prepared for next month.
  if (data.nextDraft) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-text-secondary">الشهر القادم (مُجهَّز)</h2>
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <span className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-text-tertiary" aria-hidden />
              <span className="font-medium text-text-primary">{formatMonthLabel(data.nextDraft.year, data.nextDraft.month)}</span>
              <Badge tone="warning">مُجهَّز</Badge>
            </span>
            <Button size="sm" loading={activate.isPending} onClick={() => activate.mutate(data.nextDraft!.id)}>
              بدء الشهر الجديد
            </Button>
          </CardContent>
        </Card>
      </section>
    );
  }

  // Not prepared yet — surface why / when.
  if (data.prepBlocked) {
    return <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-text-tertiary">تحضير الأشهر موقوف لهذه المساحة حاليًا.</p>;
  }
  if (!data.canPrepare && data.blockedReason === "OUTSIDE_WINDOW" && data.windowOpensAt) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-text-tertiary">
        يمكن تجهيز {formatMonthLabel(data.target.year, data.target.month)} ابتداءً من {formatDate(data.windowOpensAt)}.
      </p>
    );
  }
  return null;
}
