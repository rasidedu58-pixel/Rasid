"use client";

import { useState } from "react";
import Link from "next/link";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { Button, EmptyState, ErrorState, MetricCell, MetricStrip, SegmentedControl, SkeletonRows, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableScroll, cn, formatDate, formatMoney } from "@academic-precision/ui";
import { PageHeader } from "../../../components/shell/page-header";
import { useWorkspace } from "../../../lib/workspace-provider";
import { qk } from "../../../lib/query-keys";
import { fetchCollectionQueue, fetchFinanceSummary } from "../../../lib/api/finance";
import { RecordPaymentDialog } from "../../../components/finance/record-payment-dialog";
import { ObligationStatusBadge } from "../students/[studentId]/overview-tab";
import { PaymentLedger } from "./payment-ledger";

type FinanceView = "attention" | "ledger";

export default function FinancePage() {
  const { workspaceId, hasPermission } = useWorkspace();
  const [view, setView] = useState<FinanceView>("attention");
  const [payingObligation, setPayingObligation] = useState<{ id: string; remainingMinor: number } | null>(null);

  const summaryQuery = useQuery({
    queryKey: workspaceId ? qk.finance.summary(workspaceId) : ["finance-summary", "none"],
    queryFn: () => fetchFinanceSummary(workspaceId!),
    enabled: !!workspaceId && hasPermission("finance.overview"),
  });

  // Phase 15 — the queue is cursor-paginated now (the API previously
  // silently truncated at 200 rows; at 3,000 students that hid real money).
  const queueQuery = useInfiniteQuery({
    queryKey: workspaceId ? qk.finance.collectionQueue(workspaceId) : ["collection-queue", "none"],
    queryFn: ({ pageParam }) => fetchCollectionQueue(workspaceId!, pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.page?.nextCursor ?? null,
    enabled: !!workspaceId,
  });

  const queueItems = queueQuery.data?.pages.flatMap((p) => p.items) ?? [];
  const TODAY = new Date();
  TODAY.setHours(0, 0, 0, 0);

  return (
    <>
      <PageHeader title="المركز المالي" description="ما يحتاج متابعة وسجل الدفعات — في مكان واحد." />

      {summaryQuery.data ? (
        <MetricStrip className="mb-6">
          <MetricCell label="إجمالي المستحق" value={formatMoney(summaryQuery.data.totalNetDueMinor)} />
          <MetricCell label="المحصّل" value={formatMoney(summaryQuery.data.totalPaidMinor)} tone="success" />
          <MetricCell label="المتبقّي" value={formatMoney(summaryQuery.data.totalRemainingMinor)} />
          <MetricCell
            label="المتأخر"
            value={formatMoney(summaryQuery.data.overdueRemainingMinor)}
            tone={summaryQuery.data.overdueCount > 0 ? "danger" : "default"}
            sub={summaryQuery.data.overdueCount > 0 ? `${summaryQuery.data.overdueCount} التزام متأخر` : "لا متأخرات"}
          />
        </MetricStrip>
      ) : null}

      <div className="mb-4">
        <SegmentedControl<FinanceView>
          aria-label="عرض المالية"
          value={view}
          onChange={setView}
          options={[
            { value: "attention", label: "يحتاج متابعة" },
            { value: "ledger", label: "سجل الدفعات" },
          ]}
        />
      </div>

      {view === "ledger" ? (
        <PaymentLedger />
      ) : queueQuery.isLoading ? (
        <SkeletonRows rows={6} />
      ) : queueQuery.isError ? (
        <ErrorState onRetry={() => queueQuery.refetch()} />
      ) : queueItems.length === 0 ? (
        <EmptyState icon={<Wallet className="h-8 w-8 text-text-tertiary" aria-hidden />} title="لا توجد التزامات مالية معلّقة" description="كل الطلاب مسدّدون بالكامل حاليًا." />
      ) : (
        <>
          <TableScroll>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الطالب</TableHead>
                  <TableHead className="hidden lg:table-cell">الاستحقاق</TableHead>
                  <TableHead className="text-end">المتبقّي</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead className="text-end" aria-label="إجراء" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {queueItems.map((item) => {
                  const overdue = new Date(item.dueDate) < TODAY;
                  return (
                    <TableRow key={item.obligationId} className="transition-colors hover:bg-surface-sunken/40">
                      <TableCell>
                        <Link href={`/students/${item.studentId}`} className="font-medium text-text-primary hover:text-brand">
                          {item.studentName}
                        </Link>
                        <span className={cn("mt-0.5 block text-xs tabular-nums lg:hidden", overdue ? "text-danger" : "text-text-tertiary")}>
                          {overdue ? "متأخر · " : ""}
                          {formatDate(item.dueDate)}
                        </span>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <span className={cn("inline-flex items-center gap-1.5 text-sm tabular-nums", overdue ? "font-medium text-danger" : "text-text-secondary")}>
                          {overdue ? <span className="h-1.5 w-1.5 rounded-full bg-danger" aria-hidden /> : null}
                          {formatDate(item.dueDate)}
                        </span>
                      </TableCell>
                      <TableCell className="text-end text-base font-semibold tabular-nums text-text-primary">{formatMoney(item.remainingMinor)}</TableCell>
                      <TableCell>
                        <ObligationStatusBadge status={item.status} />
                      </TableCell>
                      <TableCell className="text-end">
                        {hasPermission("payments.record") ? (
                          <Button size="sm" onClick={() => setPayingObligation({ id: item.obligationId, remainingMinor: item.remainingMinor })}>
                            تسجيل دفعة
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableScroll>
          {queueQuery.hasNextPage ? (
            <div className="mt-4 flex justify-center">
              <Button variant="outline" loading={queueQuery.isFetchingNextPage} onClick={() => void queueQuery.fetchNextPage()}>
                عرض المزيد
              </Button>
            </div>
          ) : null}
        </>
      )}

      {payingObligation ? (
        <RecordPaymentDialog obligationId={payingObligation.id} remainingMinor={payingObligation.remainingMinor} open onOpenChange={() => setPayingObligation(null)} onRecorded={() => queueQuery.refetch()} />
      ) : null}
    </>
  );
}
