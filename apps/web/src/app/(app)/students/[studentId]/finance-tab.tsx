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

/**
 * One labelled money/date figure in the obligation card. Label above value,
 * so a narrow column never has to fit both on one line — which is what made
 * the old single `·`-joined sentence unreadable on a phone.
 */
function ObligationFigure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-text-tertiary">{label}</dt>
      <dd className={strong ? "text-sm font-semibold tabular-nums text-text-primary" : "text-sm tabular-nums text-text-secondary"}>{value}</dd>
    </div>
  );
}

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
          {/* Phase 3 responsive fix. This was one flex ROW at every width: a
              column holding the badge plus a single `·`-joined line of three
              money figures, with the "تسجيل دفعة" button pinned beside it.
              At 360px the three figures wrapped into a ragged block and the
              button ate the width they needed.

              Now the figures are a real 2-up grid (4-up from `sm`) so each
              keeps its own label and line, and the button drops below them
              full-width on a phone instead of competing for the same row.
              The due date joins the grid as the fourth figure — it was a
              12px aside beside the badge before. No money value, no
              formatter and no condition changed. */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <ObligationStatusBadge status={obligation.status} />
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
                <ObligationFigure label="المستحق" value={formatMoney(obligation.netDueMinor)} />
                <ObligationFigure label="المدفوع" value={formatMoney(obligation.amountPaidMinor)} />
                <ObligationFigure label="المتبقي" value={formatMoney(obligation.remainingMinor)} strong />
                <ObligationFigure label="تاريخ الاستحقاق" value={formatDate(obligation.dueDate)} />
              </dl>
            </div>
            {obligation.status !== "PAID" && canWrite("CORE_OPERATIONS") ? (
              <Button size="sm" className="w-full justify-center sm:w-auto sm:shrink-0" onClick={() => setPayingObligation({ id: obligation.id, remainingMinor: obligation.remainingMinor })}>
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
