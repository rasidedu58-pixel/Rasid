"use client";

import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiRequestError, isNotFound, isForbidden } from "./api/client";
import { initErrorTracking } from "./error-tracking";

/**
 * Sensible, product-appropriate defaults (§35): a short staleTime so
 * screens don't hammer the API on every focus/mount, but data is never
 * treated as "cache forever" — this is an operational tool people use to
 * make real decisions, stale attendance/finance numbers are a real risk.
 * 404/403 never retry (they are not transient) — every other failure gets
 * a couple of quick retries before surfacing an ErrorState.
 *
 * Phase 15D.1 — background-traffic reduction:
 * - `refetchOnWindowFocus: false` — refocusing the tab no longer fires a
 *   simultaneous refetch of EVERY stale query (the "refocus storm"). Live
 *   operational surfaces stay current through their OWN polling (the Action
 *   Center and the notifications bell set an explicit `refetchInterval`);
 *   list/detail screens refetch on navigation/mount or a manual refresh, and
 *   are anyway treated fresh for `staleTime`. This trades a small amount of
 *   on-refocus freshness on passive lists for a large drop in redundant API
 *   calls.
 * - `refetchIntervalInBackground: false` (React Query's default, made
 *   explicit) — interval polls PAUSE while the tab is hidden and resume (with
 *   an immediate fetch) when it is shown again, so a backgrounded tab makes
 *   no periodic requests at all.
 */
export function AppQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            refetchIntervalInBackground: false,
            retry: (failureCount, error) => {
              if (error instanceof ApiRequestError && (isNotFound(error) || isForbidden(error))) return false;
              return failureCount < 2;
            },
          },
          mutations: {
            retry: false,
          },
        },
      }),
  );

  // Phase 15D.1 — initialize browser error tracking once on mount. No-op
  // unless NEXT_PUBLIC_SENTRY_DSN is configured (and @sentry/nextjs installed).
  useEffect(() => {
    void initErrorTracking();
  }, []);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
