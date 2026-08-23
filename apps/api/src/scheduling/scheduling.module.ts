import { Module } from "@nestjs/common";
import { SupabaseAuthGuard } from "../identity/api/guards/supabase-auth.guard";
import { JwtTokenVerifier, TOKEN_VERIFIER } from "../identity/infrastructure/jwt-token-verifier";
import { PermissionGuard } from "../team/api/guards/permission.guard";
import { PermissionResolverService } from "../team/application/permission-resolver.service";
import { GROUP_OWNERSHIP_PORT } from "../team/application/ports/group-ownership.port";
import { TEAM_REPOSITORY } from "../team/application/ports/team-repository.port";
import { DrizzleTeamRepository } from "../team/infrastructure/drizzle-team.repository";
import { DrizzleGroupOwnershipAdapter } from "../team/infrastructure/group-ownership.adapter";
import { GroupsController } from "./api/groups.controller";
import { MonthsController } from "./api/months.controller";
import { GroupMonthsController } from "./api/group-months.controller";
import { SessionsController } from "./api/sessions.controller";
import { SchedulingService } from "./application/scheduling.service";
import { PreviewTokenService } from "./application/preview-token.service";
import { SCHEDULING_REPOSITORY } from "./application/ports/scheduling-repository.port";
import { DrizzleSchedulingRepository } from "./infrastructure/drizzle-scheduling.repository";

/**
 * Phase 3 — Months / Groups / Scheduling module. Mirrors `TeamModule`'s
 * pattern of re-providing `SupabaseAuthGuard`/`TOKEN_VERIFIER` directly
 * (rather than importing `IdentityModule`) and re-providing `PermissionGuard`
 * + its dependencies directly (rather than importing `TeamModule`) to avoid
 * a module cycle, since neither Phase 1's nor Phase 2's module currently
 * exports its providers.
 */
@Module({
  controllers: [GroupsController, MonthsController, GroupMonthsController, SessionsController],
  providers: [
    SchedulingService,
    PreviewTokenService,
    PermissionResolverService,
    PermissionGuard,
    SupabaseAuthGuard,
    { provide: TOKEN_VERIFIER, useClass: JwtTokenVerifier },
    { provide: TEAM_REPOSITORY, useClass: DrizzleTeamRepository },
    { provide: GROUP_OWNERSHIP_PORT, useClass: DrizzleGroupOwnershipAdapter },
    { provide: SCHEDULING_REPOSITORY, useClass: DrizzleSchedulingRepository },
  ],
})
export class SchedulingModule {}
