import { Module } from "@nestjs/common";
import { SupabaseAuthGuard } from "../identity/api/guards/supabase-auth.guard";
import { JwtTokenVerifier, TOKEN_VERIFIER } from "../identity/infrastructure/jwt-token-verifier";
import { PermissionGuard } from "../team/api/guards/permission.guard";
import { PermissionResolverService } from "../team/application/permission-resolver.service";
import { GROUP_OWNERSHIP_PORT } from "../team/application/ports/group-ownership.port";
import { TEAM_REPOSITORY } from "../team/application/ports/team-repository.port";
import { DrizzleTeamRepository } from "../team/infrastructure/drizzle-team.repository";
import { DrizzleGroupOwnershipAdapter } from "../team/infrastructure/group-ownership.adapter";
import { EntitlementGuard } from "../billing/api/guards/entitlement.guard";
import { ENTITLEMENT_REPOSITORY } from "../billing/application/ports/entitlement-repository.port";
import { DrizzleEntitlementRepository } from "../billing/infrastructure/drizzle-entitlement.repository";
import { ReportsController } from "./api/reports.controller";
import { ExportsController } from "./api/exports.controller";
import { ReportsService } from "./application/reports.service";
import { REPORTS_REPOSITORY } from "./application/ports/reports-repository.port";
import { DrizzleReportsRepository } from "./infrastructure/drizzle-reports.repository";

/**
 * Phase 9 — Reports module. Mirrors `BillingModule`'s (Phase 8) pattern of
 * re-providing `SupabaseAuthGuard`/`TOKEN_VERIFIER`/`PermissionGuard`/
 * `EntitlementGuard` + dependencies directly (rather than importing
 * `IdentityModule`/`TeamModule`/`BillingModule`) to avoid a module cycle,
 * since none of them export their providers.
 */
@Module({
  controllers: [ReportsController, ExportsController],
  providers: [
    ReportsService,
    PermissionResolverService,
    PermissionGuard,
    EntitlementGuard,
    SupabaseAuthGuard,
    { provide: TOKEN_VERIFIER, useClass: JwtTokenVerifier },
    { provide: TEAM_REPOSITORY, useClass: DrizzleTeamRepository },
    { provide: GROUP_OWNERSHIP_PORT, useClass: DrizzleGroupOwnershipAdapter },
    { provide: ENTITLEMENT_REPOSITORY, useClass: DrizzleEntitlementRepository },
    { provide: REPORTS_REPOSITORY, useClass: DrizzleReportsRepository },
  ],
})
export class ReportsModule {}
