import { createElement as h, type ComponentType, type ReactElement } from "react";
import { REPORT_BRAND, formatMoneyMinor, type ReportColumn, type ReportDocument, type ReportSection } from "./report-document";
import { REPORT_FONT_DESCRIPTORS, REPORT_PDF_FONT } from "./report-fonts";

/**
 * @react-pdf/renderer is ESM-only. To stay safe under CJS (NestJS runtime on
 * any Node version, and jest), we load it via a NATIVE dynamic import that
 * tsc must not downlevel to `require` — `new Function("m", "return import(m)")`
 * keeps a real `import()`. The primitives are then used to build the tree.
 */
type PdfModule = typeof import("@react-pdf/renderer");
const nativeImport = new Function("m", "return import(m)") as (m: string) => Promise<PdfModule>;
let pdfModule: PdfModule | undefined;
let fontsRegistered = false;

async function loadPdf(): Promise<PdfModule> {
  if (!pdfModule) pdfModule = await nativeImport("@react-pdf/renderer");
  if (!fontsRegistered) {
    pdfModule.Font.register({ family: REPORT_PDF_FONT, fonts: REPORT_FONT_DESCRIPTORS.map((f) => ({ src: f.src, fontWeight: f.fontWeight })) });
    // Arabic must never be hyphen-broken mid-word.
    pdfModule.Font.registerHyphenationCallback((word: string) => [word]);
    fontsRegistered = true;
  }
  return pdfModule;
}

type Primitives = { Document: ComponentType<Record<string, unknown>>; Page: ComponentType<Record<string, unknown>>; Text: ComponentType<Record<string, unknown>>; View: ComponentType<Record<string, unknown>> };

/**
 * Premium Arabic RTL PDF renderer (@react-pdf/renderer + Tajawal). A real
 * document — not a screenshot: navy identity header, teal summary, sectioned
 * tables with a repeating column header (`fixed`) so long tables keep their
 * header across A4 pages, and a footer with page numbers. fontkit handles
 * Arabic shaping + bidi, so mixed Arabic/number cells render naturally.
 */

const c = (hex: string) => `#${hex}`;

const S = {
  page: { paddingTop: 40, paddingBottom: 56, paddingHorizontal: 36, fontFamily: REPORT_PDF_FONT, fontSize: 10, color: c(REPORT_BRAND.text), direction: "rtl" as const },
  headerBand: { backgroundColor: c(REPORT_BRAND.navy), color: c(REPORT_BRAND.white), paddingVertical: 12, paddingHorizontal: 14, borderRadius: 6, marginBottom: 14 },
  brand: { fontSize: 18, fontWeight: 700, color: c(REPORT_BRAND.white), textAlign: "right" as const },
  subtitle: { fontSize: 12, color: "#CBD5E1", marginTop: 2, textAlign: "right" as const },
  metaRow: { flexDirection: "row-reverse" as const, flexWrap: "wrap" as const, gap: 12, marginTop: 6 },
  metaItem: { fontSize: 9, color: "#94A3B8", textAlign: "right" as const },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: c(REPORT_BRAND.navy), marginTop: 14, marginBottom: 6, textAlign: "right" as const },
  summaryWrap: { flexDirection: "row-reverse" as const, flexWrap: "wrap" as const, gap: 8, marginBottom: 6 },
  summaryCard: { width: "31%", backgroundColor: c(REPORT_BRAND.tealSoft), borderRadius: 6, padding: 8 },
  summaryLabel: { fontSize: 8, color: c(REPORT_BRAND.neutral), textAlign: "right" as const },
  summaryValue: { fontSize: 12, fontWeight: 700, color: c(REPORT_BRAND.navy), textAlign: "right" as const, marginTop: 2 },
  theadRow: { flexDirection: "row-reverse" as const, backgroundColor: c(REPORT_BRAND.teal) },
  th: { color: c(REPORT_BRAND.white), fontWeight: 700, fontSize: 9, paddingVertical: 5, paddingHorizontal: 6, textAlign: "right" as const },
  tr: { flexDirection: "row-reverse" as const, borderBottomWidth: 0.5, borderBottomColor: c(REPORT_BRAND.border) },
  trAlt: { backgroundColor: c(REPORT_BRAND.rowAlt) },
  td: { fontSize: 9, paddingVertical: 4, paddingHorizontal: 6, textAlign: "right" as const, color: c(REPORT_BRAND.text) },
  note: { fontSize: 11, color: c(REPORT_BRAND.neutral), textAlign: "center" as const, marginTop: 24 },
  footer: { position: "absolute" as const, bottom: 24, left: 36, right: 36, flexDirection: "row-reverse" as const, justifyContent: "space-between" as const, borderTopWidth: 0.5, borderTopColor: c(REPORT_BRAND.border), paddingTop: 6 },
  footerText: { fontSize: 8, color: c(REPORT_BRAND.neutral) },
};

function flexFor(col: ReportColumn): number {
  return Math.max(1, Math.round((col.width ?? 18) / 6));
}

function formatCell(col: ReportColumn, raw: unknown): string {
  if (col.type === "money" && typeof raw === "number") return formatMoneyMinor(raw);
  if (col.type === "int" && typeof raw === "number") return raw.toLocaleString("en-US");
  return raw == null ? "—" : String(raw);
}

function renderTable(P: Primitives, section: ReportSection): ReactElement {
  const { Text, View } = P;
  const header = h(
    View,
    { style: S.theadRow, fixed: true },
    ...section.columns.map((col) => h(Text, { key: col.key, style: { ...S.th, flex: flexFor(col) } }, col.label)),
  );
  const rows = section.rows.map((rowData, ri) =>
    h(
      View,
      { key: ri, style: ri % 2 === 1 ? { ...S.tr, ...S.trAlt } : S.tr, wrap: false },
      ...section.columns.map((col) => h(Text, { key: col.key, style: { ...S.td, flex: flexFor(col) } }, formatCell(col, rowData[col.key]))),
    ),
  );
  return h(View, { key: section.title }, h(Text, { style: S.sectionTitle }, section.title), header, ...rows);
}

function renderDocument(P: Primitives, doc: ReportDocument): ReactElement {
  const { Document, Page, Text, View } = P;
  const footer = h(
    View,
    { style: S.footer, fixed: true },
    h(Text, { style: S.footerText }, "راصد"),
    h(Text, { style: S.footerText, render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) => `صفحة ${pageNumber} من ${totalPages}` }),
    h(Text, { style: S.footerText }, doc.meta.exportedAt.toLocaleDateString("ar-EG")),
  );

  const head = h(
    View,
    { style: S.headerBand },
    h(Text, { style: S.brand }, `راصد · ${doc.docTitle}`),
    h(Text, { style: S.subtitle }, doc.subtitle),
    h(
      View,
      { style: S.metaRow },
      h(Text, { style: S.metaItem }, `المعلم / مساحة العمل: ${doc.meta.workspaceName}`),
      h(Text, { style: S.metaItem }, `الفترة: ${doc.meta.period}`),
      h(Text, { style: S.metaItem }, `تاريخ التصدير: ${doc.meta.exportedAt.toLocaleDateString("ar-EG")}`),
    ),
  );

  const summary = h(
    View,
    { style: S.summaryWrap },
    ...doc.summary.map((item, i) => h(View, { key: i, style: S.summaryCard }, h(Text, { style: S.summaryLabel }, item.label), h(Text, { style: S.summaryValue }, item.value))),
  );

  const body = doc.emptyNote
    ? [h(Text, { key: "empty", style: S.note }, doc.emptyNote)]
    : [summary, ...doc.sections.filter((s) => s.rows.length > 0).map((s) => renderTable(P, s))];

  return h(Document, { title: `${doc.docTitle} — ${doc.subtitle}`, author: "راصد" }, h(Page, { size: "A4", style: S.page }, footer, head, ...body));
}

export async function renderReportPdf(doc: ReportDocument): Promise<Buffer> {
  const PDF = await loadPdf();
  const P: Primitives = {
    Document: PDF.Document as unknown as ComponentType<Record<string, unknown>>,
    Page: PDF.Page as unknown as ComponentType<Record<string, unknown>>,
    Text: PDF.Text as unknown as ComponentType<Record<string, unknown>>,
    View: PDF.View as unknown as ComponentType<Record<string, unknown>>,
  };
  return PDF.renderToBuffer(renderDocument(P, doc));
}
