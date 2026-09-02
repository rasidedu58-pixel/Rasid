import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

/**
 * Splash replay gating (Launch/UX items 14–15). The splash must replay on every
 * FULL page load (a fresh JS execution context) but NEVER on an in-app SPA route
 * change (same context). That distinction is a module-level `shownThisLoad` flag,
 * so here a fresh `vi.resetModules()` + dynamic import models a full reload, while
 * re-rendering the SAME imported module models an SPA remount.
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

describe("SplashScreen — replay gating", () => {
  beforeEach(() => mockReducedMotion(false));

  it("shows the brand-entrance overlay on a fresh full page load (new JS context)", async () => {
    vi.resetModules();
    const { SplashScreen } = await import("../components/marketing/splash-screen");
    const { container } = render(<SplashScreen />);
    expect(container.querySelector(".rasid-splash2")).toBeTruthy();
  });

  it("does NOT replay on an in-app SPA remount within the same JS context", async () => {
    vi.resetModules();
    const { SplashScreen } = await import("../components/marketing/splash-screen");

    const first = render(<SplashScreen />);
    expect(first.container.querySelector(".rasid-splash2")).toBeTruthy();
    first.unmount();

    // Re-mount WITHOUT resetting modules → the module-level `shownThisLoad`
    // flag is still true, so the splash must stay suppressed.
    const second = render(<SplashScreen />);
    expect(second.container.querySelector(".rasid-splash2")).toBeNull();
  });

  it("collapses to the reduced, motion-free variant under prefers-reduced-motion", async () => {
    mockReducedMotion(true);
    vi.resetModules();
    const { SplashScreen } = await import("../components/marketing/splash-screen");
    const { container } = render(<SplashScreen />);
    const el = container.querySelector(".rasid-splash2");
    expect(el).toBeTruthy();
    expect(el?.getAttribute("data-reduced")).toBe("true");
  });
});
