import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { ConfigModule } from "./config/config.module";
import { HealthModule } from "./health/health.module";
import { IdentityModule } from "./identity/identity.module";
import { TeamModule } from "./team/team.module";
import { SchedulingModule } from "./scheduling/scheduling.module";
import { StudentsModule } from "./students/students.module";
import { SessionModeModule } from "./session-mode/session-mode.module";
import { FinanceModule } from "./finance/finance.module";
import { AttentionModule } from "./attention/attention.module";
import { BillingModule } from "./billing/billing.module";
import { ReportsModule } from "./reports/reports.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { ActionCenterModule } from "./action-center/action-center.module";
import { PlatformAdminModule } from "./platform-admin/platform-admin.module";
import { RequestIdMiddleware } from "./common/middleware/request-id.middleware";
import { loadRateLimitConfig } from "./common/rate-limit/rate-limit.config";

/**
 * Root application module. Phase 0 wired only infrastructure concerns
 * (config, health). Phase 1 added the identity/auth/workspace module.
 * Phase 2 added the RBAC/Team/Permissions module. Phase 3 added the
 * Months/Groups/Scheduling module. Phase 4 added the Students/Guardians/
 * QR/Enrollment module. Phase 5 added the Session Mode module. Phase 6
 * added the Finance module. Phase 7 added the Attention/Follow-up module.
 * Phase 8 added the Billing/Entitlements module. Phase 9 added Reports/
 * Notifications/Action Center. Phase 10 adds global rate limiting
 * (`ThrottlerGuard`, applied via `APP_GUARD` — every route is rate-limited
 * by the `default` tier unless overridden per-route with `@Throttle(...)`;
 * see `common/rate-limit/rate-limit.config.ts` for the named tiers and
 * their rationale).
 */
const rateLimitConfig = loadRateLimitConfig();

// Deliberately ONE named tracker ("default"), not six — a route that needs
// a tighter/looser tier overrides THIS tracker's own limit/ttl locally via
// `@Throttle({ default: { limit, ttl } })` (see rate-limit.config.ts's own
// per-category numbers, applied at each override site). Registering six
// separate always-on trackers would check every request against all six
// simultaneously (the library's default multi-throttler behavior), which
// is not what per-endpoint-category tiers are meant to express here.
@Module({
  imports: [
    ConfigModule,
    ThrottlerModule.forRoot([{ name: "default", ttl: rateLimitConfig.default.ttlMs, limit: rateLimitConfig.default.limit }]),
    HealthModule,
    IdentityModule,
    TeamModule,
    SchedulingModule,
    StudentsModule,
    SessionModeModule,
    FinanceModule,
    AttentionModule,
    BillingModule,
    ReportsModule,
    NotificationsModule,
    ActionCenterModule,
    PlatformAdminModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
  }
}
