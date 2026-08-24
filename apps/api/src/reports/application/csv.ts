/**
 * Minimal CSV UTF-8 serializer — Phase 9. V1's ONLY export format (PRD §38/
 * §45/§46: PDF and Excel/XLSX are explicitly deferred; no code path for
 * either exists). Deliberately no external dependency — RFC 4180 quoting
 * (double any `"`, wrap a field in quotes if it contains a comma/quote/
 * newline) is a handful of lines, not worth a package.
 *
 * A UTF-8 BOM is prepended so Excel (still the most common CSV consumer)
 * renders Arabic headers/values correctly instead of mojibake — an
 * operational choice, not a documented requirement (the docs only say
 * "CSV UTF-8", nothing about BOM either way).
 */
const UTF8_BOM = "﻿";

function escapeCsvField(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv(columns: Array<{ key: string; label: string }>, rows: Array<Record<string, unknown>>): string {
  const header = columns.map((c) => escapeCsvField(c.label)).join(",");
  const body = rows.map((row) => columns.map((c) => escapeCsvField(row[c.key])).join(",")).join("\r\n");
  return UTF8_BOM + header + "\r\n" + body + (rows.length > 0 ? "\r\n" : "");
}
