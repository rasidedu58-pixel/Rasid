import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { ConfigModule } from "./config/config.module";
import { HealthModule } from "./health/health.module";
import { IdentityModule } from "./identity/identity.module";
import { TeamModule } from "./team/team.module";
import { SchedulingModule } from "./scheduling/scheduling.module";
import { RequestIdMiddleware } from "./common/middleware/request-id.middleware";

/**
 * Root application module. Phase 0 wired only infrastructure concerns
 * (config, health). Phase 1 added the identity/auth/workspace module.
 * Phase 2 added the RBAC/Team/Permissions module. Phase 3 adds the
 * Months/Groups/Scheduling module.
 */
@Module({
  imports: [ConfigModule, HealthModule, IdentityModule, TeamModule, SchedulingModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
  }
}
