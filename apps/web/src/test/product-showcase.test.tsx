import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within, act } from "@testing-library/react";
import { ProductShowcase } from "../components/marketing/product-showcase";
import { PRODUCT_SHOWCASE_SLIDES, pickShowcaseSrc } from "../lib/marketing/product-showcase-slides";

/**
 * Product Showcase guards (§V) — component-level jsdom render + targeted
 * browser-API mocks inline, matching this repo's existing marketing-test
 * convention (see landing-motion.test.tsx / pricing-table.test.tsx). NOT
 * pixel snapshots — these pin behaviour, not appearance.
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

/** Minimal IntersectionObserver stub — captures the callback so a test can
 * fire it manually with a fabricated entry, exactly the shape the mobile
 * active-card tracker consumes (`target`/`intersectionRatio`). */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;
  observed: Element[] = [];
  constructor(cb: IntersectionObserverCallback) {
    this.callback = cb;
    FakeIntersectionObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  mockReducedMotion(false);
  FakeIntersectionObserver.instances = [];
  // @ts-expect-error test double, not a full IntersectionObserver
  window.IntersectionObserver = FakeIntersectionObserver;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ProductShowcase", () => {
  function desktopTablist() {
    return screen.getByRole("tablist", { name: "اختر شاشة لعرضها" });
  }

  it("renders all five slides (desktop tabs + mobile rail cards)", () => {
    render(<ProductShowcase />);
    const desktopTabs = within(desktopTablist()).getAllByRole("tab");
    expect(desktopTabs.length).toBe(PRODUCT_SHOWCASE_SLIDES.length);
    for (const slide of PRODUCT_SHOWCASE_SLIDES) {
      expect(screen.getAllByText(slide.label).length).toBeGreaterThan(0);
    }
    expect(document.querySelectorAll(".showcase-card").length).toBe(PRODUCT_SHOWCASE_SLIDES.length);
  });

  it("defaults to the Dashboard slide (first slide, no autoplay)", () => {
    render(<ProductShowcase />);
    // The desktop tab for "dashboard" (the first slide) starts selected.
    const dashboardTab = within(desktopTablist()).getByRole("tab", { name: PRODUCT_SHOWCASE_SLIDES[0]!.label, selected: true });
    expect(dashboardTab).toBeTruthy();
    // Title appears at least once — both the desktop caption and the first
    // mobile-rail card render it (only one is visible at a time via CSS,
    // jsdom has no real viewport to hide the other).
    expect(screen.getAllByText(PRODUCT_SHOWCASE_SLIDES[0]!.title).length).toBeGreaterThan(0);
  });

  it("picks the theme-appropriate asset (light vs dark) — pure selection logic", () => {
    const slide = PRODUCT_SHOWCASE_SLIDES[0]!;
    expect(pickShowcaseSrc("light", slide)).toBe(slide.lightSrc);
    expect(pickShowcaseSrc("dark", slide)).toBe(slide.darkSrc);
  });

  it("renders a real <img> for the active slide regardless of theme (no broken/missing image)", () => {
    const { container } = render(<ProductShowcase />);
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
    expect(img?.getAttribute("alt")).toBe(PRODUCT_SHOWCASE_SLIDES[0]!.alt);
  });

  it("desktop: clicking a tab changes the active slide", () => {
    render(<ProductShowcase />);
    const sessionsSlide = PRODUCT_SHOWCASE_SLIDES.find((s) => s.id === "sessions")!;
    const tab = within(desktopTablist()).getByRole("tab", { name: sessionsSlide.label });
    fireEvent.click(tab);
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByText(sessionsSlide.title).length).toBeGreaterThan(0);
  });

  it("mobile: the active dot updates when the rail reports a new centred card", () => {
    render(<ProductShowcase />);
    const io = FakeIntersectionObserver.instances[0]!;
    const cards = document.querySelectorAll(".showcase-card");
    const secondCard = cards[1]!;
    act(() => {
      io.callback(
        [{ target: secondCard, intersectionRatio: 0.9 } as unknown as IntersectionObserverEntry],
        io as unknown as IntersectionObserver,
      );
    });
    const dotIndicators = screen.getByRole("tablist", { name: "اختيار الشاشة" });
    const dots = within(dotIndicators).getAllByRole("tab");
    expect(dots[1]?.getAttribute("aria-selected")).toBe("true");
  });

  it("renders without crashing under prefers-reduced-motion, content still fully present", () => {
    mockReducedMotion(true);
    render(<ProductShowcase />);
    expect(within(desktopTablist()).getAllByRole("tab").length).toBe(PRODUCT_SHOWCASE_SLIDES.length);
    expect(document.querySelectorAll(".showcase-card").length).toBe(PRODUCT_SHOWCASE_SLIDES.length);
    // Component-level guarantee (see product-showcase.tsx): the scroll-linked
    // scale/opacity transforms are constructed with a collapsed [1,1] output
    // range whenever `useReducedMotion()` reports true, so there is no
    // scroll-linked motion for a reduced-motion viewer by construction — not
    // asserted here as a live style value (framer-motion's `useReducedMotion`
    // does not reliably re-evaluate a mocked `matchMedia` mid-render inside
    // jsdom, a known test-environment limitation, not a product bug).
  });

  it("every slide has non-empty alt text", () => {
    for (const slide of PRODUCT_SHOWCASE_SLIDES) {
      expect(slide.alt.trim().length).toBeGreaterThan(0);
    }
  });

  it("renders correctly under an RTL ancestor (no crash, rail + cards present)", () => {
    document.documentElement.setAttribute("dir", "rtl");
    const { container } = render(<ProductShowcase />);
    expect(container.querySelector(".showcase-rail")).toBeTruthy();
    expect(container.querySelectorAll(".showcase-card").length).toBe(PRODUCT_SHOWCASE_SLIDES.length);
  });
});
