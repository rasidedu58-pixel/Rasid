"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, ErrorState, LoadingRegion, formatDate, formatMoney } from "@academic-precision/ui";
import { fetchStudentObligations } from "../../../../lib/api/students";
import { qk } from "../../../../lib/query-keys";
import { useWorkspace } from "../../../../lib/workspace-provider";
import { ObligationStatusBadge } from "./overview-tab";
import { RecordPaymentDialog } from "../../../../components/finance/record-payment-dialog";
import { Button } from "@academic-precision/ui";

export function FinanceTab({ studentId }: { studentId: string }) {
  const { workspaceId, canWrite } = useWorkspace();
  const [payingObligation, setPayingObligation] = useState<{ id: string; remainingMinor: number } | null>(null);

  const query = useQuery({
    queryKey: workspaceId ? qk.students.obligations(workspaceId, studentId) : ["obligations", "none"],
    queryFn: () => fetchStudentObligations(workspaceId!, studentId),
    enabled: !!workspaceId,
  });

  if (query.isLoading) return <LoadingRegion />;
  if (query.isError) return <ErrorState onRetry={() => query.refetch()} />;

  const items = query.data!.obligations;
  if (items.length === 0) {
    return <Card className="p-6 text-center text-sm text-text-secondary">لا توجد التزامات مالية.</Card>;
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map(({ obligation }) => (
        <Card key={obligation.id} className="flex flex-col gap-3 p-4">
          <div className="flex items-start justify-between">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <ObligationStatusBadge status={obligation.status} />
                <span className="text-xs text-text-tertiary">استحقاق {formatDate(obligation.dueDate)}</span>
              </div>
              <p className="text-sm text-text-secondary tabular-nums">
                المستحق: {formatMoney(obligation.netDueMinor)} · المدفوع: {formatMoney(obligation.amountPaidMinor)} · المتبقي: {formatMoney(obligation.remainingMinor)}
              </p>
            </div>
            {obligation.status !== "PAID" && canWrite("CORE_OPERATIONS") ? (
              <Button size="sm" onClick={() => setPayingObligation({ id: obligation.id, remainingMinor: obligation.remainingMinor })}>
                تسجيل دفعة
              </Button>
            ) : null}
          </div>
        </Card>
      ))}

      {payingObligation ? (
        <RecordPaymentDialog obligationId={payingObligation.id} remainingMinor={payingObligation.remainingMinor} open onOpenChange={() => setPayingObligation(null)} onRecorded={() => query.refetch()} />
      ) : null}
    </div>
  );
}
