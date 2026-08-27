import { ServiceUnavailableException } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

// Phase 15D.1 — readiness now pings Postgres via `pingDatabase()`.
// Mock the DB module so the check is deterministic (no real connection).
const mockPing = jest.fn();
jest.mock("@academic-precision/database", () => ({
  pingDatabase: () => mockPing(),
}));

describe("HealthController", () => {
  let controller: HealthController;

  beforeEach(async () => {
    mockPing.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [HealthService],
    }).compile();
    controller = module.get(HealthController);
  });

  it("returns ok status for /health (liveness — never touches the DB)", () => {
    const result = controller.getHealth();
    expect(result.status).toBe("ok");
    expect(typeof result.timestamp).toBe("string");
    expect(mockPing).not.toHaveBeenCalled();
  });

  it("returns ok for /ready when the database ping succeeds", async () => {
    mockPing.mockResolvedValue(undefined);
    const result = await controller.getReadiness();
    expect(result.status).toBe("ok");
    expect(mockPing).toHaveBeenCalledTimes(1);
  });

  it("returns 503 (ServiceUnavailable) for /ready when the database ping fails (unreachable or timed out)", async () => {
    mockPing.mockRejectedValue(new Error("database readiness ping timed out"));
    await expect(controller.getReadiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
