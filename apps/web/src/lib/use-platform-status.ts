"use client";

import { useQuery } from "@tanstack/react-query";
import { deriveOverallStatus, type PlatformServiceKey, type ServiceStatus } from "@academic-precision/contracts";
import { qk } from "./query-keys";
import { fetchPlatformStatus } from "./api/platform-admin";
import { isForbidden } from "./api/client";

/**
 * Shared platform-status derivation. The server reports database + worker; the
 * CLIENT proves `web` (this page is being served) and `api` (the request
 * succeeded) liveness, then derives `overall` deterministically. Reused by the
 * Issues page, the command-center widget, and the Customer 360 notice.
 */
export function usePlatformStatus() {
  const query = useQuery({
    queryKey: qk.platformAdmin.status(),
    queryFn: fetchPlatformStatus,
    refetchInterval: 30_000,
    retry: (failureCount, error) => !isForbidden(error) && failureCount < 2,
  });

  const forbidden = isForbidden(query.error);
  const services: Record<PlatformServiceKey, ServiceStatus> = {
    web: "OPERATIONAL", // proven: this page was served to the browser
    api: query.data ? "OPERATIONAL" : query.isError && !forbidden ? "DOWN" : "UNKNOWN",
    database: query.data?.database ?? "UNKNOWN",
    worker: query.data?.worker ?? "UNKNOWN",
  };
  const overall = deriveOverallStatus(services);

  return {
    query,
    forbidden,
    services,
    overall,
    data: query.data ?? null,
    updatedAt: query.dataUpdatedAt || null,
  };
}
