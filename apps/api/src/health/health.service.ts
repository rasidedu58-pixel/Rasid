import { Injectable } from "@nestjs/common";

export type HealthStatus = {
  status: "ok";
  timestamp: string;
};

/**
 * Pure infrastructure health/readiness logic. No business modules, no
 * database access — Phase 0 endpoints only prove the process is alive.
 */
@Injectable()
export class HealthService {
  getHealth(): HealthStatus {
    return { status: "ok", timestamp: new Date().toISOString() };
  }

  getReadiness(): HealthStatus {
    return { status: "ok", timestamp: new Date().toISOString() };
  }
}
