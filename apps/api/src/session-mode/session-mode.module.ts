import { Module } from "@nestjs/common";
import { SupabaseAuthGuard } from "../identity/api/guards/supabase-auth.guard";
import { JwtTokenVerifier, TOKEN_VERIFIER } from "../identity/infrastructure/jwt-token-verifier";
import { PermissionGuard } from "../team/api/guards/permission.guard";
import { PermissionResolverService } from "../team/application/permission-resolver.service";
import { GROUP_OWNERSHIP_PORT } from "../team/application/ports/group-ownership.port";
import { TEAM_REPOSITORY } from "../team/application/ports/team-repository.port";
import { DrizzleTeamRepository } from "../team/infrastructure/drizzle-team.repository";
import { DrizzleGroupOwnershipAdapter } from "../team/infrastructure/group-ownership.adapter";
import { SessionModeController } from "./api/session-mode.controller";
import { SessionModeService } from "./application/session-mode.service";
import { SESSION_MODE_REPOSITORY } from "./application/ports/session-mode-repository.port";
import { DrizzleSessionModeRepository } from "./infrastructure/drizzle-session-mode.repository";

/**
 * Phase 5 — Session Mode module. Mirrors `StudentsModule`'s (Phase 4)
 * pattern of re-providing `SupabaseAuthGuard`/`TOKEN_VERIFIER`/
 * `PermissionGuard` + dependencies directly (rather than importing
 * `IdentityModule`/`TeamModule`) to avoid a module cycle, since neither
 * exports its providers.
 */
@Module({
  controllers: [SessionModeController],
  providers: [
    SessionModeService,
    PermissionResolverService,
    PermissionGuard,
    SupabaseAuthGuard,
    { provide: TOKEN_VERIFIER, useClass: JwtTokenVerifier },
    { provide: TEAM_REPOSITORY, useClass: DrizzleTeamRepository },
    { provide: GROUP_OWNERSHIP_PORT, useClass: DrizzleGroupOwnershipAdapter },
    { provide: SESSION_MODE_REPOSITORY, useClass: DrizzleSessionModeRepository },
  ],
})
export class SessionModeModule {}
