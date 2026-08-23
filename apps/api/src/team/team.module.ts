import { Module } from "@nestjs/common";
import { SupabaseAuthGuard } from "../identity/api/guards/supabase-auth.guard";
import { JwtTokenVerifier, TOKEN_VERIFIER } from "../identity/infrastructure/jwt-token-verifier";
import { TeamController } from "./api/team.controller";
import { PermissionGuard } from "./api/guards/permission.guard";
import { PermissionResolverService } from "./application/permission-resolver.service";
import { TeamService } from "./application/team.service";
import { GROUP_OWNERSHIP_PORT } from "./application/ports/group-ownership.port";
import { TEAM_REPOSITORY } from "./application/ports/team-repository.port";
import { DrizzleTeamRepository } from "./infrastructure/drizzle-team.repository";
import { DrizzleGroupOwnershipAdapter } from "./infrastructure/group-ownership.adapter";
import { EntitlementGuard } from "../billing/api/guards/entitlement.guard";
import { ENTITLEMENT_REPOSITORY } from "../billing/application/ports/entitlement-repository.port";
import { DrizzleEntitlementRepository } from "../billing/infrastructure/drizzle-entitlement.repository";

/**
 * Phase 2 — RBAC / Membership / Permissions module. Depends on
 * `SupabaseAuthGuard`, imported directly from `identity/api/guards`
 * (Phase 1) rather than importing `IdentityModule`, to avoid a module
 * cycle and avoid modifying Phase 1's module (which does not currently
 * `export` its providers). `SupabaseAuthGuard` itself only depends on
 * `TOKEN_VERIFIER`, which is re-provided here so it can be instantiated
 * standalone in this module's injector.
 *
 * Phase 8 retrofit: `EntitlementGuard`/`ENTITLEMENT_REPOSITORY` re-provided
 * directly too (same avoid-a-cycle rationale) so the membership write
 * routes can carry `@RequireEntitlement("TEAM_MANAGEMENT")`.
 */
@Module({
  controllers: [TeamController],
  providers: [
    TeamService,
    PermissionResolverService,
    PermissionGuard,
    EntitlementGuard,
    SupabaseAuthGuard,
    { provide: TOKEN_VERIFIER, useClass: JwtTokenVerifier },
    { provide: TEAM_REPOSITORY, useClass: DrizzleTeamRepository },
    { provide: GROUP_OWNERSHIP_PORT, useClass: DrizzleGroupOwnershipAdapter },
    { provide: ENTITLEMENT_REPOSITORY, useClass: DrizzleEntitlementRepository },
  ],
})
export class TeamModule {}
