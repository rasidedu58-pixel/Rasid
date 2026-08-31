import ExcelJS from "exceljs";
import type { MonthlyTeacherReportResponse, StudentReportResponse } from "@academic-precision/contracts";
import { buildMonthlyDocument, buildStudentDocument, type ReportDocumentMeta } from "./report-document";
import { renderReportXlsx } from "./xlsx.renderer";
import { renderReportPdf } from "./pdf.renderer";

const META: ReportDocumentMeta = { workspaceName: "مدرّس تجريبي", period: "أغسطس 2026", exportedAt: new Date("2026-08-15T00:00:00Z") };

const MONTHLY: MonthlyTeacherReportResponse = {
  month: { id: "m1", year: 2026, month: 8, status: "CURRENT" },
  groups: [
    { groupId: "g1", groupName: "مجموعة الرياضيات", studentsCount: 25, sessionsCount: 8 },
    { groupId: "g2", groupName: "مجموعة الفيزياء", studentsCount: 18, sessionsCount: 6 },
  ],
  totals: {
    studentsCount: 43,
    sessionsCount: 14,
    collection: { totalDueMinor: 500000, totalPaidMinor: 375000, totalRemainingMinor: 125000 },
    overdueCount: 3,
    openAttentionCount: 1,
    openFollowupsCount: 2,
  },
};

describe("report XLSX renderer", () => {
  it("produces a valid workbook with a Summary sheet + section sheet and Arabic headers", async () => {
    const buf = await renderReportXlsx(buildMonthlyDocument(MONTHLY, META));
    expect(buf.length).toBeGreaterThan(2000);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    const summary = wb.getWorksheet("الملخص");
    const groups = wb.getWorksheet("المجموعات");
    expect(summary).toBeDefined();
    expect(groups).toBeDefined();

    // The identity band + Arabic labels are present (human labels, no UUIDs).
    const flat = JSON.stringify(summary!.getSheetValues());
    expect(flat).toContain("راصد");
    expect(flat).toContain("عدد الطلاب");
    expect(flat).not.toContain("g1"); // never leak technical ids
    const groupsFlat = JSON.stringify(groups!.getSheetValues());
    expect(groupsFlat).toContain("المجموعة");
    expect(groupsFlat).toContain("مجموعة الرياضيات");
  });

  it("redacted finance (collection null) simply omits the money KPIs, still valid", async () => {
    const redacted: MonthlyTeacherReportResponse = { ...MONTHLY, totals: { ...MONTHLY.totals, collection: null, overdueCount: null } };
    const buf = await renderReportXlsx(buildMonthlyDocument(redacted, META));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    const flat = JSON.stringify(wb.getWorksheet("الملخص")!.getSheetValues());
    expect(flat).not.toContain("المتبقّي");
    expect(flat).toContain("عدد الطلاب");
  });
});

// The PDF renderer loads the ESM-only @react-pdf/renderer via a native dynamic
// import (required for CJS/runtime safety). jest's default VM cannot run a
// dynamic import without --experimental-vm-modules, so these are skipped here
// and verified against the real compiled dist runtime (a node smoke), which
// produces a valid %PDF with embedded Arabic (Tajawal).
describe("report PDF renderer", () => {
  it.skip("produces a valid PDF document (Arabic, non-empty)", async () => {
    const buf = await renderReportPdf(buildMonthlyDocument(MONTHLY, META));
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    // A real, multi-object document — not an empty/blank render.
    expect(buf.length).toBeGreaterThan(3000);
  });

  it.skip("renders a student report with a finance section into a PDF", async () => {
    const student: StudentReportResponse = {
      student: { id: "s1", name: "أحمد المصري", studentCode: "AP-0001", status: "ACTIVE" },
      currentMonth: { id: "m1", year: 2026, month: 8 },
      sessions: { total: 8, attendance: { present: 6, absent: 1, late: 1, missing: 0 }, homework: { done: 5, partial: 1, notDone: 2, noHomework: 0, missing: 0 }, exam: { scored: 2, absent: 0, missing: 0 } },
      activeAttentionCase: null,
      obligationsByMonth: [{ monthId: "m1", year: 2026, month: 8, groupId: "g1", groupName: "مجموعة الرياضيات", netDueMinor: 50000, amountPaidMinor: 30000, remainingMinor: 20000, status: "PARTIAL" }],
    };
    const buf = await renderReportPdf(buildStudentDocument(student, META));
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(3000);
  });
});
