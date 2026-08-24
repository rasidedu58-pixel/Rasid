import { Module } from "@nestjs/common";
import { IdentityController } from "./api/identity.controller";
import { SupabaseAuthGuard } from "./api/guards/supabase-auth.guard";
import { IdentityService } from "./application/identity.service";
import { IDENTITY_REPOSITORY } from "./application/ports/identity-repository.port";
import { DrizzleIdentityRepository } from "./infrastructure/drizzle-identity.repository";
import { JwtTokenVerifier, TOKEN_VERIFIER } from "./infrastructure/jwt-token-verifier";
import { PermissionResolverService } from "../team/application/permission-resolver.service";
import { TEAM_REPOSITORY } from "../team/application/ports/team-repository.port";
import { DrizzleTeamRepository } from "../team/infrastructure/drizzle-team.repository";

/**
 * Phase 11 retrofit: `PermissionResolverService`/`TEAM_REPOSITORY` are
 * re-provided directly here (same avoid-a-module-cycle pattern
 * `TeamModule` already uses for `SupabaseAuthGuard`/`TOKEN_VERIFIER`) so
 * `GET /me/workspaces/:id/context` can return the caller's REAL effective
 * permission set instead of the permanently-empty `[]` it shipped with —
 * that field was a documented Phase 1 stub ("the permission engine (Phase
 * 2) was never wired into this specific response") that Phase 2 itself
 * never circled back to close, since it wasn't that phase's own
 * deliverable. This is the smallest safe fix: reuse the existing,
 * already-tested resolver, no new logic.
 */
@Module({
  controllers: [IdentityController],
  providers: [
    IdentityService,
    SupabaseAuthGuard,
    PermissionResolverService,
    { provide: IDENTITY_REPOSITORY, useClass: DrizzleIdentityRepository },
    { provide: TOKEN_VERIFIER, useClass: JwtTokenVerifier },
    { provide: TEAM_REPOSITORY, useClass: DrizzleTeamRepository },
  ],
})
export class IdentityModule {}
