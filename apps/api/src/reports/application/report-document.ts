import type { GroupReportResponse, MonthlyTeacherReportResponse, StudentReportResponse } from "@academic-precision/contracts";

/**
 * Report document model — the SINGLE source of truth both the XLSX and PDF
 * renderers consume, built once from the (already permission-redacted) report
 * DTOs. This keeps the two exports identical in content and labels, and never
 * re-queries: it maps the exact DTO the preview shows.
 *
 * Rows keep RAW values (money as integer minor units, counts as numbers); each
 * column declares a `type` and the renderers format it (XLSX with real number
 * formats, PDF as Arabic strings) — so numbers never silently become text and
 * money keeps a currency format.
 */

export type ReportColumnType = "text" | "int" | "money" | "date";

export interface ReportColumn {
  key: string;
  label: string;
  type: ReportColumnType;
  /** Optional column width hint (Excel character units). */
  width?: number;
}

export interface ReportSection {
  title: string;
  columns: ReportColumn[];
  rows: Array<Record<string, unknown>>;
}

export interface ReportDocumentMeta {
  workspaceName: string;
  period: string;
  exportedAt: Date;
}

export interface ReportDocument {
  /** File-name stem (sanitized by the caller), e.g. "التقرير-الشهري-أغسطس-2026". */
  fileStem: string;
  docTitle: string;
  subtitle: string;
  meta: ReportDocumentMeta;
  summary: Array<{ label: string; value: string }>;
  sections: ReportSection[];
  /** Shown when there is genuinely nothing to report for the period. */
  emptyNote?: string;
}

// --- Brand palette (Deep Navy / Teal / Neutral) — used by both renderers ----
export const REPORT_BRAND = {
  navy: "0F172A", // Deep Navy — header band
  navySoft: "1E293B",
  teal: "0D9488", // Rasid Teal — accents / summary
  tealSoft: "CCFBF1",
  neutral: "64748B",
  rowAlt: "F1F5F9", // quiet alternating row
  border: "E2E8F0",
  white: "FFFFFF",
  text: "0F172A",
} as const;

const AR_MONTHS = ["", "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
export function arabicMonth(year: number, month: number): string {
  return `${AR_MONTHS[month] ?? month} ${year}`;
}

/** Minor units (piastres) → EGP string, e.g. 125000 → "1,250.00 ج.م". */
export function formatMoneyMinor(minor: number): string {
  const egp = minor / 100;
  return `${egp.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م`;
}

const ENROLLMENT_STATUS: Record<string, string> = { ACTIVE: "نشط", WITHDRAWN: "منسحب", COMPLETED: "مكتمل", PENDING: "قيد الانتظار" };
const OBLIGATION_STATUS: Record<string, string> = { PAID: "مدفوع", PARTIAL: "جزئي", UNPAID: "غير مدفوع", WAIVED: "معفى", OVERDUE: "متأخر" };
export const statusLabel = (v: string): string => ENROLLMENT_STATUS[v] ?? OBLIGATION_STATUS[v] ?? v;

// --- Builders ---------------------------------------------------------------
export function buildMonthlyDocument(dto: MonthlyTeacherReportResponse, meta: ReportDocumentMeta): ReportDocument {
  const t = dto.totals;
  const summary: Array<{ label: string; value: string }> = [
    { label: "عدد الطلاب", value: String(t.studentsCount) },
    { label: "عدد الحصص", value: String(t.sessionsCount) },
    { label: "حالات متابعة مفتوحة", value: String(t.openAttentionCount) },
    { label: "متابعات مجدولة", value: String(t.openFollowupsCount) },
  ];
  if (t.collection) {
    summary.push(
      { label: "إجمالي المطلوب", value: formatMoneyMinor(t.collection.totalDueMinor) },
      { label: "إجمالي المحصّل", value: formatMoneyMinor(t.collection.totalPaidMinor) },
      { label: "المتبقّي", value: formatMoneyMinor(t.collection.totalRemainingMinor) },
      { label: "التزامات متأخرة", value: String(t.overdueCount ?? 0) },
    );
  }
  const sections: ReportSection[] = [
    {
      title: "المجموعات",
      columns: [
        { key: "groupName", label: "المجموعة", type: "text", width: 34 },
        { key: "studentsCount", label: "عدد الطلاب", type: "int", width: 14 },
        { key: "sessionsCount", label: "عدد الحصص", type: "int", width: 14 },
      ],
      rows: dto.groups.map((g) => ({ groupName: g.groupName, studentsCount: g.studentsCount, sessionsCount: g.sessionsCount })),
    },
  ];
  return {
    fileStem: `التقرير-الشهري-${arabicMonth(dto.month.year, dto.month.month)}`,
    docTitle: "التقرير الشهري",
    subtitle: arabicMonth(dto.month.year, dto.month.month),
    meta,
    summary,
    sections,
    emptyNote: dto.groups.length === 0 && t.studentsCount === 0 ? "لا توجد بيانات لهذه الفترة ضمن نطاق رؤيتك." : undefined,
  };
}

export function buildGroupDocument(dto: GroupReportResponse, meta: ReportDocumentMeta): ReportDocument {
  const a = dto.attendance;
  const h = dto.homework;
  const summary: Array<{ label: string; value: string }> = [
    { label: "عدد الطلاب", value: String(dto.roster.length) },
    { label: "الحصص (كلي/مكتملة)", value: `${dto.sessions.total} / ${dto.sessions.completed}` },
    { label: "حضور", value: `${a.present} حاضر · ${a.absent} غائب · ${a.late} متأخر` },
    { label: "واجبات", value: `${h.done} تام · ${h.partial} جزئي · ${h.notDone} غير مُنجز` },
    { label: "سجلات ناقصة", value: String(dto.missingRecordsCount) },
  ];
  if (dto.collection) {
    summary.push(
      { label: "إجمالي المطلوب", value: formatMoneyMinor(dto.collection.totalDueMinor) },
      { label: "المتبقّي", value: formatMoneyMinor(dto.collection.totalRemainingMinor) },
      { label: "التزامات متأخرة", value: String(dto.collection.overdueCount) },
    );
  }
  return {
    fileStem: `تقرير-المجموعة-${dto.group.name}`,
    docTitle: "تقرير المجموعة",
    subtitle: dto.group.name + (dto.currentMonth ? ` — ${arabicMonth(dto.currentMonth.year, dto.currentMonth.month)}` : ""),
    meta,
    summary,
    sections: [
      {
        title: "قائمة الطلاب",
        columns: [
          { key: "studentName", label: "الطالب", type: "text", width: 34 },
          { key: "statusLabel", label: "حالة القيد", type: "text", width: 16 },
        ],
        rows: dto.roster.map((r) => ({ studentName: r.studentName, statusLabel: statusLabel(r.status) })),
      },
    ],
    emptyNote: dto.roster.length === 0 ? "لا يوجد طلاب في هذه المجموعة لهذه الفترة." : undefined,
  };
}

export function buildStudentDocument(dto: StudentReportResponse, meta: ReportDocumentMeta): ReportDocument {
  const s = dto.sessions;
  const summary: Array<{ label: string; value: string }> = [
    { label: "الحصص", value: String(s.total) },
    { label: "حضور", value: `${s.attendance.present} حاضر · ${s.attendance.absent} غائب · ${s.attendance.late} متأخر` },
    { label: "واجبات", value: `${s.homework.done} تام · ${s.homework.partial} جزئي · ${s.homework.notDone} غير مُنجز` },
    { label: "اختبارات", value: `${s.exam.scored} مُقيَّم · ${s.exam.absent} غائب` },
  ];
  const sections: ReportSection[] = [];
  if (dto.obligationsByMonth.length > 0) {
    sections.push({
      title: "الالتزامات المالية",
      columns: [
        { key: "monthLabel", label: "الشهر", type: "text", width: 16 },
        { key: "groupName", label: "المجموعة", type: "text", width: 28 },
        { key: "netDueMinor", label: "المطلوب", type: "money", width: 16 },
        { key: "amountPaidMinor", label: "المدفوع", type: "money", width: 16 },
        { key: "remainingMinor", label: "المتبقّي", type: "money", width: 16 },
        { key: "statusLabel", label: "الحالة", type: "text", width: 14 },
      ],
      rows: dto.obligationsByMonth.map((o) => ({
        monthLabel: arabicMonth(o.year, o.month),
        groupName: o.groupName,
        netDueMinor: o.netDueMinor,
        amountPaidMinor: o.amountPaidMinor,
        remainingMinor: o.remainingMinor,
        statusLabel: statusLabel(o.status),
      })),
    });
  }
  return {
    fileStem: `تقرير-الطالب-${dto.student.name}`,
    docTitle: "تقرير الطالب",
    subtitle: dto.student.name + (dto.currentMonth ? ` — ${arabicMonth(dto.currentMonth.year, dto.currentMonth.month)}` : ""),
    meta,
    summary,
    sections,
    emptyNote: s.total === 0 && sections.length === 0 ? "لا توجد بيانات لهذا الطالب في الفترة الحالية." : undefined,
  };
}
