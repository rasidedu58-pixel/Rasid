"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CalendarRange, Plus } from "lucide-react";
import { Badge, Button, Card, CardContent, EmptyState, ErrorState, LoadingRegion, formatMonthLabel } from "@academic-precision/ui";
import { PageHeader } from "../../../components/shell/page-header";
import { useWorkspace } from "../../../lib/workspace-provider";
import { qk } from "../../../lib/query-keys";
import { fetchMonths } from "../../../lib/api/scheduling";

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
  const history = months.filter((m) => m.status !== "CURRENT");

  return (
    <>
      <PageHeader
        title="الأشهر التشغيلية"
        description="الشهر التشغيلي يحدد المجموعات النشطة ورسومها وجدولها لهذا الشهر."
        actions={
          isOwner ? (
            <Button asChild size="sm">
              <Link href="/months/new">
                <Plus className="h-4 w-4" aria-hidden />
                {current ? "شهر جديد" : "تجهيز أول شهر تشغيلي"}
              </Link>
            </Button>
          ) : undefined
        }
      />

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
            isOwner ? (
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
