import { Test, type TestingModule } from "@nestjs/testing";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

describe("HealthController", () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [HealthService],
    }).compile();

    controller = module.get(HealthController);
  });

  it("returns ok status for /health", () => {
    const result = controller.getHealth();
    expect(result.status).toBe("ok");
    expect(typeof result.timestamp).toBe("string");
  });

  it("returns ok status for /ready", () => {
    const result = controller.getReadiness();
    expect(result.status).toBe("ok");
  });
});
