import Link from "next/link";
import type { StudentReportResponse } from "@academic-precision/contracts";
import { Badge, Card, SectionCard, formatDate, formatMoney, formatMonthLabel } from "@academic-precision/ui";

export function OverviewTab({ report }: { report: StudentReportResponse }) {
  return (
    <div className="flex flex-col gap-4">
      {report.activeAttentionCase ? (
        <Card className="border-warning/30 bg-warning-subtle p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-warning">هذا الطالب ضمن المتابعة حاليًا</p>
              <p className="text-xs text-text-secondary">فُتحت الحالة في {formatDate(report.activeAttentionCase.openedAt)}</p>
            </div>
            <Link href={`/attention/${report.activeAttentionCase.id}`} className="text-sm font-medium text-brand hover:underline">
              عرض الحالة
            </Link>
          </div>
        </Card>
      ) : null}

      {!report.currentMonth ? (
        <Card className="p-6 text-center text-sm text-text-secondary">لا يوجد تسجيل في الشهر الحالي.</Card>
      ) : (
        <SectionCard title={`الحصص هذا الشهر — ${formatMonthLabel(report.currentMonth.year, report.currentMonth.month)}`}>
          <div className="grid grid-cols-3 gap-4">
            <StatGroup title="الحضور" items={[["حاضر", report.sessions.attendance.present], ["غائب", report.sessions.attendance.absent], ["متأخر", report.sessions.attendance.late], ["غير مسجّل", report.sessions.attendance.missing]]} />
            <StatGroup title="الواجب" items={[["منجز", report.sessions.homework.done], ["جزئي", report.sessions.homework.partial], ["غير منجز", report.sessions.homework.notDone], ["غير مسجّل", report.sessions.homework.missing]]} />
            <StatGroup title="الامتحان" items={[["تم الرصد", report.sessions.exam.scored], ["غياب", report.sessions.exam.absent], ["غير مسجّل", report.sessions.exam.missing]]} />
          </div>
        </SectionCard>
      )}

      <SectionCard title="الالتزامات المالية">
        {report.obligationsByMonth.length === 0 ? (
          <p className="text-sm text-text-secondary">لا توجد التزامات مالية مسجّلة.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {report.obligationsByMonth.map((o) => (
              <li key={`${o.monthId}-${o.groupId}`} className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm text-text-primary">
                    {o.groupName} — {formatMonthLabel(o.year, o.month)}
                  </p>
                  <p className="text-xs text-text-secondary tabular-nums">
                    {formatMoney(o.amountPaidMinor)} من {formatMoney(o.netDueMinor)}
                  </p>
                </div>
                <ObligationStatusBadge status={o.status} />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

function StatGroup({ title, items }: { title: string; items: Array<[string, number]> }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium text-text-secondary">{title}</p>
      {items.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between text-sm">
          <span className="text-text-secondary">{label}</span>
          <span className="tabular-nums font-medium text-text-primary">{value}</span>
        </div>
      ))}
    </div>
  );
}

export function ObligationStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: "success" | "warning" | "danger" }> = {
    PAID: { label: "مدفوع بالكامل", tone: "success" },
    PARTIAL: { label: "دفع جزئي", tone: "warning" },
    UNPAID: { label: "غير مدفوع", tone: "danger" },
  };
  const entry = map[status] ?? { label: status, tone: "warning" as const };
  return <Badge tone={entry.tone}>{entry.label}</Badge>;
}
