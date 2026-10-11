import type { StudentReportResponse } from "@academic-precision/contracts";
import { Badge, Card, SectionCard, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Timeline, TimelineItem, formatDate, formatMoney, formatMonthLabel } from "@academic-precision/ui";
import { formatExamScore } from "../../../../lib/student-summary";

const OBLIGATION_TONE: Record<string, "success" | "warning" | "danger"> = { PAID: "success", PARTIAL: "warning", UNPAID: "danger" };

export function OverviewTab({ report }: { report: StudentReportResponse }) {
  return (
    <div className="flex flex-col gap-4">
      {!report.currentMonth ? (
        <Card className="p-6 text-center text-sm text-text-secondary">لا يوجد تسجيل في الشهر الحالي.</Card>
      ) : (
        <SectionCard title={`الحصص هذا الشهر — ${formatMonthLabel(report.currentMonth.year, report.currentMonth.month)}`}>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <StatGroup title="الحضور" items={[["حاضر", report.sessions.attendance.present], ["غائب", report.sessions.attendance.absent], ["متأخر", report.sessions.attendance.late], ["غير مسجّل", report.sessions.attendance.missing]]} />
            <StatGroup title="الواجب" items={[["منجز", report.sessions.homework.done], ["جزئي", report.sessions.homework.partial], ["غير منجز", report.sessions.homework.notDone], ["لا واجب", report.sessions.homework.noHomework], ["غير مسجّل", report.sessions.homework.missing]]} />
            <StatGroup title="الامتحان" items={[["تم الرصد", report.sessions.exam.scored], ["غياب", report.sessions.exam.absent], ["غير مسجّل", report.sessions.exam.missing]]} />
          </div>
        </SectionCard>
      )}

      {report.examScores.length > 0 ? (
        <SectionCard title="درجات الامتحانات" description="كل امتحان رُصد لهذا الطالب في الشهر الحالي.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>التاريخ</TableHead>
                <TableHead>الامتحان</TableHead>
                <TableHead className="text-end">الدرجة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.examScores.map((e) => (
                <TableRow key={e.sessionId}>
                  <TableCell className="text-sm tabular-nums text-text-secondary">{formatDate(e.sessionDate)}</TableCell>
                  <TableCell className="text-sm text-text-primary">{e.examName ?? "امتحان"}</TableCell>
                  <TableCell className="text-end">
                    {e.status === "SCORED" ? (
                      <span className="text-base font-semibold tabular-nums text-text-primary">{formatExamScore(e.score, e.maxScore)}</span>
                    ) : (
                      <Badge tone="warning">غياب</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
      ) : null}

      <SectionCard title="السجل المالي">
        {report.obligationsByMonth.length === 0 ? (
          <p className="text-sm text-text-secondary">لا توجد التزامات مالية مسجّلة.</p>
        ) : (
          <Timeline>
            {report.obligationsByMonth.map((o, i) => (
              <TimelineItem
                key={`${o.monthId}-${o.groupId}`}
                tone={OBLIGATION_TONE[o.status] ?? "warning"}
                date={formatMonthLabel(o.year, o.month)}
                title={o.groupName}
                context={<span className="tabular-nums">{formatMoney(o.amountPaidMinor)} من {formatMoney(o.netDueMinor)}</span>}
                action={<ObligationStatusBadge status={o.status} />}
                last={i === report.obligationsByMonth.length - 1}
              />
            ))}
          </Timeline>
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
