import { Module } from "@nestjs/common";
import { SupabaseAuthGuard } from "../identity/api/guards/supabase-auth.guard";
import { JwtTokenVerifier, TOKEN_VERIFIER } from "../identity/infrastructure/jwt-token-verifier";
import { PermissionGuard } from "../team/api/guards/permission.guard";
import { PermissionResolverService } from "../team/application/permission-resolver.service";
import { GROUP_OWNERSHIP_PORT } from "../team/application/ports/group-ownership.port";
import { TEAM_REPOSITORY } from "../team/application/ports/team-repository.port";
import { DrizzleTeamRepository } from "../team/infrastructure/drizzle-team.repository";
import { DrizzleGroupOwnershipAdapter } from "../team/infrastructure/group-ownership.adapter";
import { NotificationsController } from "./api/notifications.controller";
import { NotificationsService } from "./application/notifications.service";
import { NOTIFICATIONS_REPOSITORY } from "./application/ports/notifications-repository.port";
import { DrizzleNotificationsRepository } from "./infrastructure/drizzle-notifications.repository";

/**
 * Phase 9 — Notifications module. Same re-provide-guards-directly pattern
 * as every module since Phase 3.
 */
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    PermissionResolverService,
    PermissionGuard,
    SupabaseAuthGuard,
    { provide: TOKEN_VERIFIER, useClass: JwtTokenVerifier },
    { provide: TEAM_REPOSITORY, useClass: DrizzleTeamRepository },
    { provide: GROUP_OWNERSHIP_PORT, useClass: DrizzleGroupOwnershipAdapter },
    { provide: NOTIFICATIONS_REPOSITORY, useClass: DrizzleNotificationsRepository },
  ],
})
export class NotificationsModule {}
