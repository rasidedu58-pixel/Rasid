import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { ConfigModule } from "./config/config.module";
import { HealthModule } from "./health/health.module";
import { RequestIdMiddleware } from "./common/middleware/request-id.middleware";

/**
 * Root application module. Phase 0 wires only infrastructure concerns
 * (config, health) — no business modules are registered here yet.
 */
@Module({
  imports: [ConfigModule, HealthModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
  }
}
