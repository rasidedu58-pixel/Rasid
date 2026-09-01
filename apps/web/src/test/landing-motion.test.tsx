import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { OperatingRhythm } from "../components/marketing/operating-rhythm";
import { HeroProductPreview } from "../components/marketing/hero-product-preview";
import { SpotlightCard } from "../components/marketing/spotlight-card";

/**
 * Basic guards for the Landing Motion Language — NOT pixel snapshots. They pin
 * the properties that matter for correctness/accessibility/performance:
 *  - content is real and present regardless of motion (SEO + reduced-motion);
 *  - reduced-motion starts no loops/timers;
 *  - the spotlight wrapper attaches NO global (window) listeners;
 *  - card content stays keyboard-reachable.
 */

function mockReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? reduce : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Landing motion — OperatingRhythm", () => {
  beforeEach(() => mockReducedMotion(true));

  it("renders all four beats (سجّل → افهم → تصرّف → تابع) even under reduced motion", () => {
    render(<OperatingRhythm />);
    for (const beat of ["سجّل", "افهم", "تصرّف", "تابع"]) {
      expect(screen.getByText(beat)).toBeTruthy();
    }
  });

  it("starts no timers when reduced motion is requested", () => {
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    render(<OperatingRhythm />);
    // The IntersectionObserver-driven sequence must never be scheduled.
    expect(timeoutSpy).not.toHaveBeenCalled();
  });
});

describe("Landing motion — HeroProductPreview", () => {
  beforeEach(() => mockReducedMotion(true));

  it("renders the honest mockup labels without crashing under reduced motion", () => {
    render(<HeroProductPreview />);
    expect(screen.getByText("يحتاج إجراء الآن")).toBeTruthy();
    expect(screen.getByText("مركز الإجراءات")).toBeTruthy();
  });

  it("starts no focus-loop interval under reduced motion", () => {
    const intervalSpy = vi.spyOn(globalThis, "setInterval");
    render(<HeroProductPreview />);
    expect(intervalSpy).not.toHaveBeenCalled();
  });
});

describe("Landing motion — SpotlightCard", () => {
  beforeEach(() => mockReducedMotion(false));

  it("renders children and attaches NO global window listeners", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    render(
      <SpotlightCard>
        <a href="/signup">ابدأ مجانًا</a>
      </SpotlightCard>,
    );
    // Pointer tracking is element-local only — never a global mousemove.
    const globalMoves = addSpy.mock.calls.filter(([type]) => type === "mousemove" || type === "pointermove");
    expect(globalMoves.length).toBe(0);
  });

  it("keeps interactive children keyboard-reachable", () => {
    render(
      <SpotlightCard>
        <a href="/signup">ابدأ مجانًا</a>
      </SpotlightCard>,
    );
    const link = screen.getByText("ابدأ مجانًا") as HTMLAnchorElement;
    link.focus();
    expect(document.activeElement).toBe(link);
  });
});
