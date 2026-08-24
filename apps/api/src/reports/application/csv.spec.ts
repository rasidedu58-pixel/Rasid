import { toCsv } from "./csv";

describe("toCsv (Phase 9 — CSV UTF-8 only)", () => {
  it("starts with a UTF-8 BOM and has an Arabic header row", () => {
    const csv = toCsv([{ key: "name", label: "الاسم" }], [{ name: "أحمد" }]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("الاسم");
    expect(csv).toContain("أحمد");
  });

  it("escapes a field containing a comma, quote, or newline per RFC 4180", () => {
    const csv = toCsv([{ key: "note", label: "ملاحظة" }], [{ note: 'a,b "c"\nd' }]);
    expect(csv).toContain('"a,b ""c""\nd"');
  });

  it("renders null/undefined as an empty field, not the literal string", () => {
    const csv = toCsv([{ key: "value", label: "القيمة" }], [{ value: null }, { value: undefined }]);
    const lines = csv.split("\r\n").slice(1); // drop header
    expect(lines[0]).toBe("");
    expect(lines[1]).toBe("");
  });

  it("produces a valid, parseable structure (same column count on every row)", () => {
    const csv = toCsv(
      [
        { key: "a", label: "A" },
        { key: "b", label: "B" },
      ],
      [
        { a: 1, b: 2 },
        { a: 3, b: 4 },
      ],
    );
    const rows = csv.slice(1).trim().split("\r\n"); // drop the leading BOM char before splitting
    expect(rows).toHaveLength(3); // header + 2 rows
    for (const row of rows) expect(row.split(",")).toHaveLength(2);
  });
});
