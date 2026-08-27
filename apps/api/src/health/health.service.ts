import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { pingDatabase } from "@academic-precision/database";

export type HealthStatus = {
  status: "ok";
  timestamp: string;
};

/**
 * Infrastructure health/readiness.
 *
 * - `/health` (liveness): the process is up and can answer HTTP. No
 *   dependencies touched — used by the platform to decide "is this process
 *   alive?" and must never fail just because a downstream is briefly down.
 * - `/ready` (readiness): Phase 15D.1 — the process can actually SERVE
 *   traffic, which for this API means its Postgres pool can reach the
 *   database. Delegates to `pingDatabase()` (a bounded-timeout `SELECT 1`, no
 *   tenant context / business query / secrets); on failure it throws 503 so
 *   the load balancer stops routing to a pod that can't reach Postgres.
 */
@Injectable()
export class HealthService {
  getHealth(): HealthStatus {
    return { status: "ok", timestamp: new Date().toISOString() };
  }

  async getReadiness(): Promise<HealthStatus> {
    try {
      await pingDatabase();
    } catch {
      // Never leak connection strings / driver internals in the response.
      throw new ServiceUnavailableException({ status: "unavailable", dependency: "database" });
    }
    return { status: "ok", timestamp: new Date().toISOString() };
  }
}
