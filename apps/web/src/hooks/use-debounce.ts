import { useEffect, useState } from "react";

/** Delays reflecting `value` until it stops changing for `delayMs` — used to avoid firing a search request on every keystroke (§35 "debounced search where needed"). */
export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
