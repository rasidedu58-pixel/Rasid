import { Module } from "@nestjs/common";
import { SupabaseAuthGuard } from "../identity/api/guards/supabase-auth.guard";
import {
  JwtTokenVerifier,
  TOKEN_VERIFIER,
} from "../identity/infrastructure/jwt-token-verifier";
import { PermissionGuard } from "../team/api/guards/permission.guard";
import { PermissionResolverService } from "../team/application/permission-resolver.service";
import { GROUP_OWNERSHIP_PORT } from "../team/application/ports/group-ownership.port";
import { TEAM_REPOSITORY } from "../team/application/ports/team-repository.port";
import { DrizzleTeamRepository } from "../team/infrastructure/drizzle-team.repository";
import { DrizzleGroupOwnershipAdapter } from "../team/infrastructure/group-ownership.adapter";
import { OnboardingController } from "./api/onboarding.controller";
import { OnboardingService } from "./application/onboarding.service";
import { ONBOARDING_REPOSITORY } from "./application/ports/onboarding-repository.port";
import { DrizzleOnboardingRepository } from "./infrastructure/drizzle-onboarding.repository";

/**
 * Onboarding module — wires the `GET /onboarding/status` aggregator plus
 * the Team dependencies needed by `PermissionGuard`. Mirrors
 * `ActionCenterModule` so the guard + workspace-scope resolution
 * behaves identically to every other read aggregator in the API.
 */
@Module({
  controllers: [OnboardingController],
  providers: [
    OnboardingService,
    PermissionResolverService,
    PermissionGuard,
    SupabaseAuthGuard,
    { provide: TOKEN_VERIFIER, useClass: JwtTokenVerifier },
    { provide: TEAM_REPOSITORY, useClass: DrizzleTeamRepository },
    { provide: GROUP_OWNERSHIP_PORT, useClass: DrizzleGroupOwnershipAdapter },
    { provide: ONBOARDING_REPOSITORY, useClass: DrizzleOnboardingRepository },
  ],
})
export class OnboardingModule {}
