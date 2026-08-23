import { Module } from "@nestjs/common";
import { SupabaseAuthGuard } from "../identity/api/guards/supabase-auth.guard";
import { JwtTokenVerifier, TOKEN_VERIFIER } from "../identity/infrastructure/jwt-token-verifier";
import { PermissionGuard } from "../team/api/guards/permission.guard";
import { PermissionResolverService } from "../team/application/permission-resolver.service";
import { GROUP_OWNERSHIP_PORT } from "../team/application/ports/group-ownership.port";
import { TEAM_REPOSITORY } from "../team/application/ports/team-repository.port";
import { DrizzleTeamRepository } from "../team/infrastructure/drizzle-team.repository";
import { DrizzleGroupOwnershipAdapter } from "../team/infrastructure/group-ownership.adapter";
import { PaymentsController } from "./api/payments.controller";
import { FinanceController } from "./api/finance.controller";
import { StudentObligationsController } from "./api/student-obligations.controller";
import { FinanceService } from "./application/finance.service";
import { FINANCE_REPOSITORY } from "./application/ports/finance-repository.port";
import { DrizzleFinanceRepository } from "./infrastructure/drizzle-finance.repository";
import { EntitlementGuard } from "../billing/api/guards/entitlement.guard";
import { ENTITLEMENT_REPOSITORY } from "../billing/application/ports/entitlement-repository.port";
import { DrizzleEntitlementRepository } from "../billing/infrastructure/drizzle-entitlement.repository";

/**
 * Phase 6 — Finance module. Mirrors `SessionModeModule`'s (Phase 5)
 * pattern of re-providing `SupabaseAuthGuard`/`TOKEN_VERIFIER`/
 * `PermissionGuard` + dependencies directly (rather than importing
 * `IdentityModule`/`TeamModule`) to avoid a module cycle, since neither
 * exports its providers.
 */
@Module({
  controllers: [PaymentsController, FinanceController, StudentObligationsController],
  providers: [
    FinanceService,
    PermissionResolverService,
    PermissionGuard,
    EntitlementGuard,
    SupabaseAuthGuard,
    { provide: TOKEN_VERIFIER, useClass: JwtTokenVerifier },
    { provide: TEAM_REPOSITORY, useClass: DrizzleTeamRepository },
    { provide: GROUP_OWNERSHIP_PORT, useClass: DrizzleGroupOwnershipAdapter },
    { provide: FINANCE_REPOSITORY, useClass: DrizzleFinanceRepository },
    { provide: ENTITLEMENT_REPOSITORY, useClass: DrizzleEntitlementRepository },
  ],
})
export class FinanceModule {}
