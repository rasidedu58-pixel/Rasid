import ExcelJS from "exceljs";
import { REPORT_BRAND, type ReportDocument, type ReportSection } from "./report-document";

/**
 * Premium XLSX renderer (ExcelJS). One "الملخص" (Summary) sheet with the Rasid
 * identity band + meta + KPIs, then one sheet per data section (never an empty
 * sheet). RTL sheet view, frozen + filtered headers, computed column widths,
 * quiet alternating rows, real number/money formats — no technical UUIDs, human
 * Arabic labels only.
 */

const MONEY_FMT = '#,##0.00 "ج.م"';
const TITLE_FONT = { name: "Calibri", bold: true } as const;

function argb(hex: string): string {
  return `FF${hex}`;
}

function brandBand(ws: ExcelJS.Worksheet, doc: ReportDocument, colSpan: number): number {
  // Row 1: راصد + report title. Row 2..: meta. Deep-navy band.
  ws.mergeCells(1, 1, 1, colSpan);
  const title = ws.getCell(1, 1);
  title.value = `راصد · ${doc.docTitle}`;
  title.font = { ...TITLE_FONT, size: 18, color: { argb: argb(REPORT_BRAND.white) } };
  title.alignment = { horizontal: "right", vertical: "middle" };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(REPORT_BRAND.navy) } };
  ws.getRow(1).height = 30;

  ws.mergeCells(2, 1, 2, colSpan);
  const sub = ws.getCell(2, 1);
  sub.value = doc.subtitle;
  sub.font = { name: "Calibri", size: 12, color: { argb: argb(REPORT_BRAND.white) } };
  sub.alignment = { horizontal: "right", vertical: "middle" };
  sub.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(REPORT_BRAND.navySoft) } };
  ws.getRow(2).height = 20;

  const metaLines = [
    `المعلم / مساحة العمل: ${doc.meta.workspaceName}`,
    `الفترة: ${doc.meta.period}`,
    `تاريخ التصدير: ${doc.meta.exportedAt.toLocaleDateString("ar-EG")}`,
  ];
  let r = 3;
  for (const line of metaLines) {
    ws.mergeCells(r, 1, r, colSpan);
    const c = ws.getCell(r, 1);
    c.value = line;
    c.font = { name: "Calibri", size: 10, color: { argb: argb(REPORT_BRAND.neutral) } };
    c.alignment = { horizontal: "right", vertical: "middle" };
    r += 1;
  }
  return r + 1; // next free row (a blank spacer between meta and content)
}

function styleHeaderRow(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(REPORT_BRAND.teal) } };
    cell.font = { name: "Calibri", bold: true, color: { argb: argb(REPORT_BRAND.white) } };
    cell.alignment = { horizontal: "right", vertical: "middle" };
    cell.border = { bottom: { style: "thin", color: { argb: argb(REPORT_BRAND.border) } } };
  });
  row.height = 20;
}

function buildSummarySheet(wb: ExcelJS.Workbook, doc: ReportDocument): void {
  const ws = wb.addWorksheet("الملخص", { views: [{ rightToLeft: true, showGridLines: false }] });
  ws.columns = [{ width: 34 }, { width: 26 }];
  let r = brandBand(ws, doc, 2);

  if (doc.emptyNote) {
    ws.mergeCells(r, 1, r, 2);
    const c = ws.getCell(r, 1);
    c.value = doc.emptyNote;
    c.font = { name: "Calibri", italic: true, color: { argb: argb(REPORT_BRAND.neutral) } };
    c.alignment = { horizontal: "right" };
    return;
  }

  const head = ws.getRow(r);
  head.getCell(1).value = "المؤشر";
  head.getCell(2).value = "القيمة";
  styleHeaderRow(head);
  r += 1;

  doc.summary.forEach((item, i) => {
    const row = ws.getRow(r);
    row.getCell(1).value = item.label;
    row.getCell(2).value = item.value;
    for (const cell of [row.getCell(1), row.getCell(2)]) {
      cell.alignment = { horizontal: "right", vertical: "middle" };
      if (i % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(REPORT_BRAND.rowAlt) } };
    }
    row.getCell(1).font = { name: "Calibri", bold: true, color: { argb: argb(REPORT_BRAND.text) } };
    r += 1;
  });
}

function buildSectionSheet(wb: ExcelJS.Workbook, doc: ReportDocument, section: ReportSection): void {
  const name = section.title.slice(0, 28); // Excel sheet-name limit is 31
  const ws = wb.addWorksheet(name, { views: [{ rightToLeft: true, showGridLines: false }] });
  ws.columns = section.columns.map((col) => ({ width: col.width ?? 18 }));

  const startRow = brandBand(ws, doc, section.columns.length);

  const head = ws.getRow(startRow);
  section.columns.forEach((col, i) => (head.getCell(i + 1).value = col.label));
  styleHeaderRow(head);

  section.rows.forEach((rowData, ri) => {
    const row = ws.getRow(startRow + 1 + ri);
    section.columns.forEach((col, ci) => {
      const cell = row.getCell(ci + 1);
      const raw = rowData[col.key];
      if (col.type === "money" && typeof raw === "number") {
        cell.value = raw / 100;
        cell.numFmt = MONEY_FMT;
      } else if (col.type === "int" && typeof raw === "number") {
        cell.value = raw;
        cell.numFmt = "#,##0";
      } else {
        cell.value = raw == null ? "" : String(raw);
      }
      cell.alignment = { horizontal: "right", vertical: "middle" };
      if (ri % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(REPORT_BRAND.rowAlt) } };
      cell.border = { bottom: { style: "hair", color: { argb: argb(REPORT_BRAND.border) } } };
    });
  });

  // Freeze the branded band + header, and enable filters over the data header.
  ws.views = [{ state: "frozen", ySplit: startRow, rightToLeft: true, showGridLines: false }];
  ws.autoFilter = { from: { row: startRow, column: 1 }, to: { row: startRow, column: section.columns.length } };
}

export async function renderReportXlsx(doc: ReportDocument): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "راصد";
  wb.created = doc.meta.exportedAt;
  buildSummarySheet(wb, doc);
  for (const section of doc.sections) {
    if (section.rows.length > 0) buildSectionSheet(wb, doc, section);
  }
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
