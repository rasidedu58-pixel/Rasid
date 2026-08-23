import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { ConfigModule } from "./config/config.module";
import { HealthModule } from "./health/health.module";
import { IdentityModule } from "./identity/identity.module";
import { TeamModule } from "./team/team.module";
import { SchedulingModule } from "./scheduling/scheduling.module";
import { StudentsModule } from "./students/students.module";
import { SessionModeModule } from "./session-mode/session-mode.module";
import { FinanceModule } from "./finance/finance.module";
import { AttentionModule } from "./attention/attention.module";
import { RequestIdMiddleware } from "./common/middleware/request-id.middleware";

/**
 * Root application module. Phase 0 wired only infrastructure concerns
 * (config, health). Phase 1 added the identity/auth/workspace module.
 * Phase 2 added the RBAC/Team/Permissions module. Phase 3 added the
 * Months/Groups/Scheduling module. Phase 4 added the Students/Guardians/
 * QR/Enrollment module. Phase 5 added the Session Mode module. Phase 6
 * added the Finance module. Phase 7 adds the Attention/Follow-up module.
 */
@Module({
  imports: [
    ConfigModule,
    HealthModule,
    IdentityModule,
    TeamModule,
    SchedulingModule,
    StudentsModule,
    SessionModeModule,
    FinanceModule,
    AttentionModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
  }
}
