import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { HealthService, type HealthStatus } from "./health.service";

/**
 * Thin controller — pure infrastructure endpoints only, no business logic.
 */
@ApiTags("health")
@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get("health")
  getHealth(): HealthStatus {
    return this.healthService.getHealth();
  }

  @Get("ready")
  getReadiness(): HealthStatus {
    return this.healthService.getReadiness();
  }
}
