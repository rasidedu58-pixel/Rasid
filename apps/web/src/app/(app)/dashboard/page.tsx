"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { CalendarClock, Sparkles } from "lucide-react";
import { Button, Card, CardContent, EmptyState, ErrorState, LoadingRegion, formatDateTime, formatMonthLabel } from "@academic-precision/ui";
import { PageHeader } from "../../../components/shell/page-header";
import { useWorkspace } from "../../../lib/workspace-provider";
import { qk } from "../../../lib/query-keys";
import { fetchActionCenter } from "../../../lib/api/reports";
import { ActionItemRow, type ActionItem } from "./action-item-row";

/**
 * The Dashboard / Action Center — the single most important screen in the
 * product (§10). Deliberately NOT a KPI dashboard: every section is either
 * "needs a decision now" or plain context, and every item explains its own
 * reason + next step. All aggregation/urgency-scoring happens server-side
 * (`GET /action-center`) — this page only renders what the backend already
 * decided, never recomputes Attention/missing-records logic itself.
 */
export default function DashboardPage() {
  const { workspaceId } = useWorkspace();

  const query = useQuery({
    queryKey: workspaceId ? qk.actionCenter.root(workspaceId) : ["action-center", "none"],
    queryFn: () => fetchActionCenter(workspaceId!),
    enabled: !!workspaceId,
    refetchInterval: 120_000,
  });

  if (query.isLoading) {
    return (
      <>
        <PageHeader title="الرئيسية" />
        <LoadingRegion label="جارٍ تحميل لوحة المتابعة..." />
      </>
    );
  }

  if (query.isError || !query.data) {
    return (
      <>
        <PageHeader title="الرئيسية" />
        <ErrorState onRetry={() => query.refetch()} />
      </>
    );
  }

  const data = query.data;
  const sections: Array<{ title: string; items: ActionItem[] }> = [
    { title: "الحضور والتسجيل", items: data.missingRecords?.items ?? [] },
    { title: "المتابعات المستحقة", items: data.followUpsDue?.items ?? [] },
    { title: "حالات تحتاج انتباه", items: data.attention?.items ?? [] },
    { title: "التحصيل المالي", items: data.collection?.items ?? [] },
  ].filter((s) => s.items.length > 0);

  const allItems = sections.flatMap((s) => s.items);
  const needsActionNow = allItems.filter((i) => i.urgency === "HIGH");
  const needsFollowUpSoon = allItems.filter((i) => i.urgency === "MEDIUM");
  const contextual = allItems.filter((i) => i.urgency === "LOW");

  return (
    <>
      <PageHeader title="الرئيسية" description={data.month ? `الشهر التشغيلي الحالي: ${formatMonthLabel(data.month.year, data.month.month)}` : undefined} />

      {data.subscriptionWarning ? (
        <Card className="mb-6 border-warning/30 bg-warning-subtle">
          <CardContent className="flex items-center justify-between gap-4 py-3">
            <p className="text-sm text-warning">{data.subscriptionWarning.message}</p>
            <Button asChild size="sm" variant="outline">
              <Link href="/settings?tab=billing">إدارة الاشتراك</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {data.nextSession ? (
        <Card className="mb-6">
          <CardContent className="flex items-center justify-between gap-4 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-subtle">
                <CalendarClock className="h-5 w-5 text-brand" aria-hidden />
              </div>
              <div>
                <p className="text-sm font-medium text-text-primary">الحصة القادمة: {data.nextSession.groupName}</p>
                <p className="text-xs text-text-secondary">{formatDateTime(data.nextSession.scheduledAt)}</p>
              </div>
            </div>
            <Button asChild size="sm">
              <Link href={`/sessions/${data.nextSession.id}`}>فتح الحصة</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {allItems.length === 0 ? (
        <EmptyState icon={<Sparkles className="h-8 w-8 text-brand" aria-hidden />} title="لا يوجد ما يحتاج إجراء الآن" description="كل شيء تحت السيطرة. سنعرض هنا أي أمر يحتاج قرارك فور ظهوره." />
      ) : (
        <div className="flex flex-col gap-6">
          {needsActionNow.length > 0 ? <ActionSection title="يحتاج إجراء الآن" items={needsActionNow} /> : null}
          {needsFollowUpSoon.length > 0 ? <ActionSection title="يحتاج متابعة قريبًا" items={needsFollowUpSoon} /> : null}
          {contextual.length > 0 ? <ActionSection title="معلومات سياقية" items={contextual} /> : null}
        </div>
      )}
    </>
  );
}

function ActionSection({ title, items }: { title: string; items: ActionItem[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-text-secondary">{title}</h2>
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <ActionItemRow key={`${item.entityType}-${item.entityId}`} item={item} />
        ))}
      </div>
    </section>
  );
}

