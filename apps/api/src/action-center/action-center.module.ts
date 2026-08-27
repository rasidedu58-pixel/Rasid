import { Module } from "@nestjs/common";
import { SupabaseAuthGuard } from "../identity/api/guards/supabase-auth.guard";
import { JwtTokenVerifier, TOKEN_VERIFIER } from "../identity/infrastructure/jwt-token-verifier";
import { PermissionGuard } from "../team/api/guards/permission.guard";
import { PermissionResolverService } from "../team/application/permission-resolver.service";
import { GROUP_OWNERSHIP_PORT } from "../team/application/ports/group-ownership.port";
import { TEAM_REPOSITORY } from "../team/application/ports/team-repository.port";
import { DrizzleTeamRepository } from "../team/infrastructure/drizzle-team.repository";
import { DrizzleGroupOwnershipAdapter } from "../team/infrastructure/group-ownership.adapter";
import { ActionCenterController } from "./api/action-center.controller";
import { ActionCenterService } from "./application/action-center.service";
import { ACTION_CENTER_REPOSITORY } from "./application/ports/action-center-repository.port";
import { DrizzleActionCenterRepository } from "./infrastructure/drizzle-action-center.repository";

/**
 * Phase 9 — Action Center module. Phase 15C: the per-section Finance/
 * Attention/Billing repository re-provisions were removed — `GET
 * /action-center` now fetches all sections in ONE transaction via
 * `DrizzleActionCenterRepository.loadActionCenterData`, which calls the
 * SAME underlying query functions from `@academic-precision/database`
 * directly (no logic duplicated, aggregation/per-section authorization
 * still this module's own job in `ActionCenterService`).
 */
@Module({
  controllers: [ActionCenterController],
  providers: [
    ActionCenterService,
    PermissionResolverService,
    PermissionGuard,
    SupabaseAuthGuard,
    { provide: TOKEN_VERIFIER, useClass: JwtTokenVerifier },
    { provide: TEAM_REPOSITORY, useClass: DrizzleTeamRepository },
    { provide: GROUP_OWNERSHIP_PORT, useClass: DrizzleGroupOwnershipAdapter },
    { provide: ACTION_CENTER_REPOSITORY, useClass: DrizzleActionCenterRepository },
  ],
})
export class ActionCenterModule {}
