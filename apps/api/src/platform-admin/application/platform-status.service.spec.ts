import "reflect-metadata";

const mockPing = jest.fn();
const mockWorker = jest.fn();
jest.mock("@academic-precision/database", () => ({
  pingDatabase: () => mockPing(),
  getWorkerHealthSnapshot: () => mockWorker(),
}));

import { PlatformStatusService } from "./platform-status.service";

const healthyWorker = {
  available: true,
  status: "OPERATIONAL" as const,
  jobs: { pending: 0, retrying: 0, dead: 0 },
  deadCount: 0,
  staleBacklogCount: 0,
  oldestUnprocessedAt: null,
  recentProblems: [],
};

describe("PlatformStatusService", () => {
  const service = new PlatformStatusService();
  beforeEach(() => {
    mockPing.mockReset();
    mockWorker.mockReset();
  });

  it("reports OPERATIONAL database + worker when both are healthy", async () => {
    mockPing.mockResolvedValue(undefined);
    mockWorker.mockResolvedValue(healthyWorker);
    const r = await service.getStatus("PLATFORM_OWNER");
    expect(r.database).toBe("OPERATIONAL");
    expect(r.worker).toBe("OPERATIONAL");
    expect(r.activeIssues).toHaveLength(0);
    expect(r.jobs).toEqual({ pending: 0, retrying: 0, dead: 0 });
  });

  it("marks database DOWN and raises a critical issue when the ping fails (readiness failure)", async () => {
    mockPing.mockRejectedValue(new Error("unreachable"));
    mockWorker.mockResolvedValue(healthyWorker);
    const r = await service.getStatus("PLATFORM_OWNER");
    expect(r.database).toBe("DOWN");
    const issue = r.activeIssues.find((i) => i.id === "database-down");
    expect(issue?.severity).toBe("CRITICAL");
  });

  it("raises a dead-letter issue when the worker has permanently failed jobs (degraded)", async () => {
    mockPing.mockResolvedValue(undefined);
    mockWorker.mockResolvedValue({ ...healthyWorker, status: "DEGRADED", deadCount: 7, jobs: { pending: 1, retrying: 2, dead: 7 } });
    const r = await service.getStatus("PLATFORM_OWNER");
    expect(r.worker).toBe("DEGRADED");
    const issue = r.activeIssues.find((i) => i.id === "worker-dead-letters");
    expect(issue?.severity).toBe("CRITICAL"); // >=5 dead ⇒ critical
  });

  it("redacts job metrics + recent problems for SUPPORT_AGENT (no health.details)", async () => {
    mockPing.mockResolvedValue(undefined);
    mockWorker.mockResolvedValue({
      ...healthyWorker,
      jobs: { pending: 3, retrying: 1, dead: 0 },
      recentProblems: [{ at: new Date("2026-08-01T00:00:00Z"), part: "notification.send", attemptCount: 2, resolved: true }],
    });
    const support = await service.getStatus("SUPPORT_AGENT");
    expect(support.jobs).toBeNull();
    expect(support.recentProblems).toHaveLength(0);
    // But an operations admin still sees them.
    const ops = await service.getStatus("OPERATIONS_ADMIN");
    expect(ops.jobs).toEqual({ pending: 3, retrying: 1, dead: 0 });
    expect(ops.recentProblems).toHaveLength(1);
  });

  it("degrades to UNKNOWN worker + unavailable source when the outbox read grant is missing", async () => {
    mockPing.mockResolvedValue(undefined);
    mockWorker.mockResolvedValue({ ...healthyWorker, available: false, status: "UNKNOWN" });
    const r = await service.getStatus("PLATFORM_OWNER");
    expect(r.worker).toBe("UNKNOWN");
    expect(r.workerSource).toBe("unavailable");
    expect(r.jobs).toBeNull();
  });
});
