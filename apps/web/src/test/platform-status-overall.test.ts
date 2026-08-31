import { describe, expect, it } from "vitest";
import { deriveOverallStatus, type PlatformServiceKey, type ServiceStatus } from "@academic-precision/contracts";

const svc = (o: Partial<Record<PlatformServiceKey, ServiceStatus>>): Record<PlatformServiceKey, ServiceStatus> => ({
  web: "OPERATIONAL",
  api: "OPERATIONAL",
  database: "OPERATIONAL",
  worker: "OPERATIONAL",
  ...o,
});

describe("deriveOverallStatus — deterministic, no AI", () => {
  it("OPERATIONAL when all criticals are up (worker OK)", () => {
    expect(deriveOverallStatus(svc({}))).toBe("OPERATIONAL");
  });

  it("OPERATIONAL when worker is UNKNOWN but criticals are up", () => {
    expect(deriveOverallStatus(svc({ worker: "UNKNOWN" }))).toBe("OPERATIONAL");
  });

  it("DOWN when a critical service (database) is DOWN", () => {
    expect(deriveOverallStatus(svc({ database: "DOWN" }))).toBe("DOWN");
  });

  it("DOWN when the API is DOWN", () => {
    expect(deriveOverallStatus(svc({ api: "DOWN" }))).toBe("DOWN");
  });

  it("DEGRADED when a service is DEGRADED", () => {
    expect(deriveOverallStatus(svc({ worker: "DEGRADED" }))).toBe("DEGRADED");
  });

  it("DEGRADED (not DOWN) when only the worker is DOWN — the app still serves", () => {
    expect(deriveOverallStatus(svc({ worker: "DOWN" }))).toBe("DEGRADED");
  });

  it("UNKNOWN when the API can't be confirmed (loading / unreachable-but-not-errored)", () => {
    expect(deriveOverallStatus(svc({ api: "UNKNOWN", database: "UNKNOWN", worker: "UNKNOWN" }))).toBe("UNKNOWN");
  });
});
