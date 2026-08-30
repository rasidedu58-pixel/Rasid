import { apiRequest } from "./client";

/**
 * Real liveness/readiness of the Rasid API (the only application health signals
 * the backend exposes — `GET /api/v1/health`, `GET /api/v1/ready`). `/ready`
 * pings the database and 503s on failure, so a rejected promise = "not ready".
 * The platform command center shows exactly these — it never fabricates an
 * "all good" it can't prove.
 */
export interface ApiHealth {
  api: "up" | "down";
  database: "up" | "down" | "unknown";
}

export async function fetchApiHealth(): Promise<ApiHealth> {
  let api: "up" | "down" = "down";
  let database: "up" | "down" | "unknown" = "unknown";
  try {
    await apiRequest<{ status: string }>("/health");
    api = "up";
  } catch {
    return { api: "down", database: "unknown" };
  }
  try {
    await apiRequest<{ status: string }>("/ready");
    database = "up";
  } catch {
    database = "down";
  }
  return { api, database };
}
