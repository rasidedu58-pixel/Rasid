"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiRequestError, isNotFound, isForbidden } from "./api/client";

/**
 * Sensible, product-appropriate defaults (§35): a short staleTime so
 * screens don't hammer the API on every focus/mount, but data is never
 * treated as "cache forever" — this is an operational tool people use to
 * make real decisions, stale attendance/finance numbers are a real risk.
 * 404/403 never retry (they are not transient) — every other failure gets
 * a couple of quick retries before surfacing an ErrorState.
 */
export function AppQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: true,
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

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
