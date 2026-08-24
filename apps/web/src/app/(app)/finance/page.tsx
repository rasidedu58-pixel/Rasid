"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { Button, EmptyState, ErrorState, SkeletonRows, StatCard, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableScroll, formatDate, formatMoney } from "@academic-precision/ui";
import { PageHeader } from "../../../components/shell/page-header";
import { useWorkspace } from "../../../lib/workspace-provider";
import { qk } from "../../../lib/query-keys";
import { fetchCollectionQueue, fetchFinanceSummary } from "../../../lib/api/finance";
import { RecordPaymentDialog } from "../../../components/finance/record-payment-dialog";
import { ObligationStatusBadge } from "../students/[studentId]/overview-tab";

export default function FinancePage() {
  const { workspaceId, hasPermission } = useWorkspace();
  const [payingObligation, setPayingObligation] = useState<{ id: string; remainingMinor: number } | null>(null);

  const summaryQuery = useQuery({
    queryKey: workspaceId ? qk.finance.summary(workspaceId) : ["finance-summary", "none"],
    queryFn: () => fetchFinanceSummary(workspaceId!),
    enabled: !!workspaceId && hasPermission("finance.overview"),
  });

  const queueQuery = useQuery({
    queryKey: workspaceId ? qk.finance.collectionQueue(workspaceId) : ["collection-queue", "none"],
    queryFn: () => fetchCollectionQueue(workspaceId!),
    enabled: !!workspaceId,
  });

  return (
    <>
      <PageHeader title="المالية" description="الالتزامات المستحقة والمتأخرة عبر كل الطلاب." />

      {summaryQuery.data ? (
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="إجمالي المستحق" value={formatMoney(summaryQuery.data.totalNetDueMinor)} />
          <StatCard label="المحصّل" value={formatMoney(summaryQuery.data.totalPaidMinor)} tone="success" />
          <StatCard label="المتبقي" value={formatMoney(summaryQuery.data.totalRemainingMinor)} />
          <StatCard label="متأخرات" value={String(summaryQuery.data.overdueCount)} tone={summaryQuery.data.overdueCount > 0 ? "danger" : undefined} />
        </div>
      ) : null}

      {queueQuery.isLoading ? (
        <SkeletonRows rows={6} />
      ) : queueQuery.isError ? (
        <ErrorState onRetry={() => queueQuery.refetch()} />
      ) : queueQuery.data!.items.length === 0 ? (
        <EmptyState icon={<Wallet className="h-8 w-8 text-text-tertiary" aria-hidden />} title="لا توجد التزامات مالية معلّقة" description="كل الطلاب مسدّدون بالكامل حاليًا." />
      ) : (
        <TableScroll>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الطالب</TableHead>
                <TableHead>الاستحقاق</TableHead>
                <TableHead>المتبقي</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {queueQuery.data!.items.map((item) => (
                <TableRow key={item.obligationId}>
                  <TableCell>
                    <Link href={`/students/${item.studentId}`} className="font-medium text-text-primary hover:text-brand hover:underline">
                      {item.studentName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-text-secondary">{formatDate(item.dueDate)}</TableCell>
                  <TableCell className="text-base font-semibold tabular-nums text-text-primary">{formatMoney(item.remainingMinor)}</TableCell>
                  <TableCell>
                    <ObligationStatusBadge status={item.status} />
                  </TableCell>
                  <TableCell>
                    <Button size="sm" onClick={() => setPayingObligation({ id: item.obligationId, remainingMinor: item.remainingMinor })}>
                      تسجيل دفعة
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      )}

      {payingObligation ? (
        <RecordPaymentDialog obligationId={payingObligation.id} remainingMinor={payingObligation.remainingMinor} open onOpenChange={() => setPayingObligation(null)} onRecorded={() => queueQuery.refetch()} />
      ) : null}
    </>
  );
}
