import { Module } from "@nestjs/common";
import { SupabaseAuthGuard } from "../identity/api/guards/supabase-auth.guard";
import { JwtTokenVerifier, TOKEN_VERIFIER } from "../identity/infrastructure/jwt-token-verifier";
import { PermissionGuard } from "../team/api/guards/permission.guard";
import { PermissionResolverService } from "../team/application/permission-resolver.service";
import { GROUP_OWNERSHIP_PORT } from "../team/application/ports/group-ownership.port";
import { TEAM_REPOSITORY } from "../team/application/ports/team-repository.port";
import { DrizzleTeamRepository } from "../team/infrastructure/drizzle-team.repository";
import { DrizzleGroupOwnershipAdapter } from "../team/infrastructure/group-ownership.adapter";
import { FINANCE_REPOSITORY } from "../finance/application/ports/finance-repository.port";
import { DrizzleFinanceRepository } from "../finance/infrastructure/drizzle-finance.repository";
import { ATTENTION_REPOSITORY } from "../attention/application/ports/attention-repository.port";
import { DrizzleAttentionRepository } from "../attention/infrastructure/drizzle-attention.repository";
import { BILLING_REPOSITORY } from "../billing/application/ports/billing-repository.port";
import { DrizzleBillingRepository } from "../billing/infrastructure/drizzle-billing.repository";
import { ActionCenterController } from "./api/action-center.controller";
import { ActionCenterService } from "./application/action-center.service";
import { ACTION_CENTER_REPOSITORY } from "./application/ports/action-center-repository.port";
import { DrizzleActionCenterRepository } from "./infrastructure/drizzle-action-center.repository";

/**
 * Phase 9 — Action Center module. Re-provides `FINANCE_REPOSITORY`/
 * `ATTENTION_REPOSITORY`/`BILLING_REPOSITORY` directly (same
 * avoid-a-module-cycle convention already established everywhere) so
 * `ActionCenterService` can reuse the EXACT SAME Collection Queue/Attention
 * Cases/Follow-ups/Subscription queries their own modules already expose,
 * rather than duplicating that logic — the aggregation itself (which
 * sections to include, per-section authorization) is this module's own
 * job; the underlying domain reads are not reimplemented.
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
    { provide: FINANCE_REPOSITORY, useClass: DrizzleFinanceRepository },
    { provide: ATTENTION_REPOSITORY, useClass: DrizzleAttentionRepository },
    { provide: BILLING_REPOSITORY, useClass: DrizzleBillingRepository },
    { provide: ACTION_CENTER_REPOSITORY, useClass: DrizzleActionCenterRepository },
  ],
})
export class ActionCenterModule {}
