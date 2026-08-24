import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebounce } from "../hooks/use-debounce";

describe("useDebounce", () => {
  it("only reflects the latest value after the delay has elapsed, not every intermediate keystroke", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 300), { initialProps: { value: "a" } });
    expect(result.current).toBe("a");

    rerender({ value: "ab" });
    rerender({ value: "abc" });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current).toBe("a"); // still the original — debounce window not elapsed yet

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe("abc"); // the LATEST value, not an intermediate one

    vi.useRealTimers();
  });
});
