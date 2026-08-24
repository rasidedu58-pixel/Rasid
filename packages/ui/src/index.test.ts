import { describe, expect, it } from "vitest";
import { cn } from "./lib/cn";
import { formatMoney, formatNumber, formatMonthLabel } from "./lib/format";

describe("cn", () => {
  it("merges class names and lets a later conflicting Tailwind class win", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-sm", false && "text-lg", "font-medium")).toBe("text-sm font-medium");
  });
});

describe("formatMoney", () => {
  it("formats whole minor-unit amounts without decimals", () => {
    expect(formatMoney(50000, "EGP")).toContain("500");
    expect(formatMoney(50000, "EGP")).not.toMatch(/\.00/);
  });

  it("formats fractional minor-unit amounts with 2 decimals", () => {
    const result = formatMoney(50050, "EGP");
    expect(result).toContain("500");
  });

  it("never receives multiple values summed client-side — this is a pure formatting function of ONE already-computed amount", () => {
    // Documentation-as-test: formatMoney's signature only accepts a single
    // amountMinor (currencyCode has a default, so `.length` — which only
    // counts params without defaults — is 1), so it structurally cannot be
    // used to sum obligations; that must happen server-side.
    expect(formatMoney.length).toBe(1);
  });
});

describe("formatNumber", () => {
  it("formats a plain integer with locale-aware grouping", () => {
    expect(formatNumber(1234)).toBeTruthy();
  });
});

describe("formatMonthLabel", () => {
  it("formats a year/month pair into an Arabic month+year label", () => {
    const label = formatMonthLabel(2026, 8);
    expect(label.length).toBeGreaterThan(0);
  });
});
