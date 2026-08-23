import { Module } from "@nestjs/common";
import { SupabaseAuthGuard } from "../identity/api/guards/supabase-auth.guard";
import { JwtTokenVerifier, TOKEN_VERIFIER } from "../identity/infrastructure/jwt-token-verifier";
import { PermissionGuard } from "../team/api/guards/permission.guard";
import { PermissionResolverService } from "../team/application/permission-resolver.service";
import { GROUP_OWNERSHIP_PORT } from "../team/application/ports/group-ownership.port";
import { TEAM_REPOSITORY } from "../team/application/ports/team-repository.port";
import { DrizzleTeamRepository } from "../team/infrastructure/drizzle-team.repository";
import { DrizzleGroupOwnershipAdapter } from "../team/infrastructure/group-ownership.adapter";
import { AttentionCasesController } from "./api/attention-cases.controller";
import { FollowupsController } from "./api/followups.controller";
import { ContactLogsController } from "./api/contact-logs.controller";
import { AttentionService } from "./application/attention.service";
import { ATTENTION_REPOSITORY } from "./application/ports/attention-repository.port";
import { DrizzleAttentionRepository } from "./infrastructure/drizzle-attention.repository";
import { EntitlementGuard } from "../billing/api/guards/entitlement.guard";
import { ENTITLEMENT_REPOSITORY } from "../billing/application/ports/entitlement-repository.port";
import { DrizzleEntitlementRepository } from "../billing/infrastructure/drizzle-entitlement.repository";

/**
 * Phase 7 — Attention/Follow-up module. Mirrors `FinanceModule`'s (Phase 6)
 * pattern of re-providing `SupabaseAuthGuard`/`TOKEN_VERIFIER`/
 * `PermissionGuard` + dependencies directly (rather than importing
 * `IdentityModule`/`TeamModule`) to avoid a module cycle, since neither
 * exports its providers.
 */
@Module({
  controllers: [AttentionCasesController, FollowupsController, ContactLogsController],
  providers: [
    AttentionService,
    PermissionResolverService,
    PermissionGuard,
    EntitlementGuard,
    SupabaseAuthGuard,
    { provide: TOKEN_VERIFIER, useClass: JwtTokenVerifier },
    { provide: TEAM_REPOSITORY, useClass: DrizzleTeamRepository },
    { provide: GROUP_OWNERSHIP_PORT, useClass: DrizzleGroupOwnershipAdapter },
    { provide: ATTENTION_REPOSITORY, useClass: DrizzleAttentionRepository },
    { provide: ENTITLEMENT_REPOSITORY, useClass: DrizzleEntitlementRepository },
  ],
})
export class AttentionModule {}
