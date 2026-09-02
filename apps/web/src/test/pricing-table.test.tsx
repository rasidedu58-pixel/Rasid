import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PricingTable } from "../components/marketing/pricing-table";
import { PRICING_PLANS } from "../lib/marketing/pricing-config";

/**
 * Pricing grid guards (Launch/UX items 16–18). The "الأنسب لمعظم المدرّسين"
 * recommended badge used to be an absolutely, negatively-positioned span that the
 * card's `overflow:hidden` sheen clipped. These pin the fix: the badge renders in
 * the card's normal flow (no `absolute`/negative offset), and the six-plan grid
 * stays responsive (1 → 2 → 3 columns).
 */
afterEach(() => cleanup());

describe("PricingTable — recommended badge & responsive grid", () => {
  const badged = PRICING_PLANS.filter((p) => p.badge);

  it("renders exactly one recommended badge", () => {
    expect(badged).toHaveLength(1);
    render(<PricingTable />);
    expect(screen.getByText(badged[0]!.badge as string)).toBeTruthy();
  });

  it("places the badge in normal flow — no absolute/negative positioning that could clip it", () => {
    const { container } = render(<PricingTable />);
    const badgeEl = screen.getByText(badged[0]!.badge as string);

    // Walk ancestors up to the grid root: none may be absolutely positioned
    // (the old clipping bug), which also rules out any `-top-*` negative offset.
    let node: HTMLElement | null = badgeEl;
    let sawAbsolute = false;
    while (node && node !== container) {
      const cls = typeof node.className === "string" ? node.className : "";
      if (/\babsolute\b/.test(cls) || /-top-/.test(cls)) sawAbsolute = true;
      node = node.parentElement;
    }
    expect(sawAbsolute).toBe(false);
  });

  it("lays the six plans out on a responsive 1 → 2 → 3 column grid", () => {
    const { container } = render(<PricingTable />);
    const grid = container.querySelector(".grid");
    const cls = grid?.className ?? "";
    expect(cls).toContain("grid-cols-1");
    expect(cls).toContain("sm:grid-cols-2");
    expect(cls).toContain("lg:grid-cols-3");
  });
});
