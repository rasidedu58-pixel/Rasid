"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { CalendarClock, CalendarRange, Sparkles } from "lucide-react";
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
  const { workspaceId, isOwner } = useWorkspace();

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

  // Greeting + one-line operating summary (§11.A) — real data only: a
  // time-of-day greeting, today's date, and a qualitative read of the queue.
  // Exact counts live on the section headers (numeric, no grammar agreement
  // pitfalls); this line stays qualitative and always true.
  const now = new Date();
  const greeting = now.getHours() < 12 ? "صباح الخير" : "مساء الخير";
  const dateLabel = new Intl.DateTimeFormat("ar-EG", { weekday: "long", day: "numeric", month: "long" }).format(now);
  const summary =
    needsActionNow.length > 0
      ? "هناك بنود عاجلة تحتاج قرارك اليوم."
      : allItems.length > 0
        ? "لا شيء عاجل — بعض البنود بحاجة إلى مراجعة."
        : "كل شيء تحت السيطرة اليوم.";

  return (
    <>
      <PageHeader eyebrow={dateLabel} title={greeting} description={summary} />

      {!data.month ? (
        <Card className="mb-4 border-brand/30 bg-brand-subtle">
          <CardContent className="flex flex-col items-start justify-between gap-3 py-4 sm:flex-row sm:items-center">
            <p className="text-sm text-text-primary">
              {isOwner ? "لا يوجد شهر تشغيلي بعد — جهّزه لتبدأ في جدولة الحصص وتسجيل الطلاب." : "بانتظار مالك المساحة لتجهيز أول شهر تشغيلي."}
            </p>
            {isOwner ? (
              <Button asChild size="sm">
                <Link href="/months/new">تجهيز أول شهر تشغيلي</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {data.subscriptionWarning ? (
        <div className="mb-3 flex items-center justify-between gap-4 rounded-lg border border-warning/30 bg-warning-subtle px-4 py-2.5">
          <p className="text-sm text-warning">{data.subscriptionWarning.message}</p>
          <Link href="/settings?tab=billing" className="shrink-0 text-sm font-medium text-warning underline">
            إدارة الاشتراك
          </Link>
        </div>
      ) : null}

      {/* Phase 13 visual QA fix: month context + next session were two
          separate full-width stacked cards (real, measured vertical space
          waste — the exact "large empty page" complaint this phase exists
          to fix). One compact context bar answers both "what context am I
          in" and "what's next" at a glance, the way an operational command
          center's status row does — no new data, same two fields. */}
      {data.month || data.nextSession ? (
        <div className="mb-6 flex flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {data.month ? (
              <div className="flex items-center gap-2 text-sm">
                <CalendarRange className="h-4 w-4 text-text-tertiary" aria-hidden />
                <span className="text-text-secondary">الشهر الحالي</span>
                <span className="font-medium text-text-primary">{formatMonthLabel(data.month.year, data.month.month)}</span>
              </div>
            ) : null}
            {data.nextSession ? (
              <div className="flex items-center gap-2 text-sm">
                <CalendarClock className="h-4 w-4 text-brand" aria-hidden />
                <span className="text-text-secondary">الحصة القادمة</span>
                <span className="font-medium text-text-primary">{data.nextSession.groupName} — {formatDateTime(data.nextSession.scheduledAt)}</span>
              </div>
            ) : null}
          </div>
          {data.nextSession ? (
            <Button asChild size="sm" className="shrink-0">
              <Link href={`/sessions/${data.nextSession.id}`}>فتح الحصة</Link>
            </Button>
          ) : null}
        </div>
      ) : null}

      {allItems.length === 0 ? (
        <EmptyState icon={<Sparkles className="h-8 w-8 text-brand" aria-hidden />} title="لا يوجد ما يحتاج إجراء الآن" description="كل شيء تحت السيطرة. سنعرض هنا أي أمر يحتاج قرارك فور ظهوره." />
      ) : (
        <div className="flex flex-col gap-8">
          {needsActionNow.length > 0 ? <ActionSection title="يحتاج إجراء الآن" items={needsActionNow} variant="urgent" /> : null}
          {needsFollowUpSoon.length > 0 ? <ActionSection title="يحتاج متابعة قريبًا" items={needsFollowUpSoon} variant="normal" /> : null}
          {contextual.length > 0 ? <ActionSection title="معلومات سياقية" items={contextual} variant="quiet" /> : null}
        </div>
      )}
    </>
  );
}

/**
 * The urgent section dominates visually (a heavier heading + a danger-tinted
 * count) so the eye lands there first; follow-up and contextual sections are
 * progressively quieter, so unrelated blocks never carry equal weight (§4).
 */
function ActionSection({ title, items, variant }: { title: string; items: ActionItem[]; variant: "urgent" | "normal" | "quiet" }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        {variant === "urgent" ? <span className="h-2 w-2 rounded-full bg-danger" aria-hidden /> : null}
        <h2 className={variant === "urgent" ? "text-base font-semibold text-text-primary" : "text-sm font-semibold text-text-secondary"}>{title}</h2>
        <span
          className={
            variant === "urgent"
              ? "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger-subtle px-1.5 text-xs font-semibold text-danger"
              : "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-surface-sunken px-1.5 text-xs font-medium text-text-tertiary"
          }
        >
          {items.length}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <ActionItemRow key={`${item.entityType}-${item.entityId}`} item={item} />
        ))}
      </div>
    </section>
  );
}

