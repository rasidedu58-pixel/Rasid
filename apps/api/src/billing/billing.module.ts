import { Module } from "@nestjs/common";
import { SupabaseAuthGuard } from "../identity/api/guards/supabase-auth.guard";
import { JwtTokenVerifier, TOKEN_VERIFIER } from "../identity/infrastructure/jwt-token-verifier";
import { PermissionGuard } from "../team/api/guards/permission.guard";
import { PermissionResolverService } from "../team/application/permission-resolver.service";
import { GROUP_OWNERSHIP_PORT } from "../team/application/ports/group-ownership.port";
import { TEAM_REPOSITORY } from "../team/application/ports/team-repository.port";
import { DrizzleTeamRepository } from "../team/infrastructure/drizzle-team.repository";
import { DrizzleGroupOwnershipAdapter } from "../team/infrastructure/group-ownership.adapter";
import { BillingController } from "./api/billing.controller";
import { EntitlementsController } from "./api/entitlements.controller";
import { WebhooksController } from "./api/webhooks.controller";
import { BillingService } from "./application/billing.service";
import { BILLING_PROVIDER } from "./application/ports/billing-provider.port";
import { BILLING_REPOSITORY } from "./application/ports/billing-repository.port";
import { ENTITLEMENT_REPOSITORY } from "./application/ports/entitlement-repository.port";
import { DrizzleBillingRepository } from "./infrastructure/drizzle-billing.repository";
import { DrizzleEntitlementRepository } from "./infrastructure/drizzle-entitlement.repository";
import { PaddleBillingProvider } from "./infrastructure/paddle-billing.provider";

/**
 * Phase 8 — Billing/Entitlements module. Mirrors `FinanceModule`'s (Phase
 * 6) pattern of re-providing `SupabaseAuthGuard`/`TOKEN_VERIFIER`/
 * `PermissionGuard` + dependencies directly (rather than importing
 * `IdentityModule`/`TeamModule`) to avoid a module cycle, since neither
 * exports its providers.
 *
 * `EntitlementGuard`/`ENTITLEMENT_REPOSITORY`/`DrizzleEntitlementRepository`
 * are NOT provided here — every module that retrofits `@RequireEntitlement`
 * onto its own routes (scheduling, students, session-mode, finance) re-
 * provides them directly in ITS OWN module, exactly like `PermissionGuard`
 * already is everywhere — this module only owns the Billing/Entitlements
 * READ endpoints (`/billing/*`, `/entitlements`, `/webhooks/paddle`)
 * themselves.
 */
@Module({
  controllers: [BillingController, EntitlementsController, WebhooksController],
  providers: [
    BillingService,
    PermissionResolverService,
    PermissionGuard,
    SupabaseAuthGuard,
    { provide: TOKEN_VERIFIER, useClass: JwtTokenVerifier },
    { provide: TEAM_REPOSITORY, useClass: DrizzleTeamRepository },
    { provide: GROUP_OWNERSHIP_PORT, useClass: DrizzleGroupOwnershipAdapter },
    { provide: BILLING_REPOSITORY, useClass: DrizzleBillingRepository },
    { provide: BILLING_PROVIDER, useClass: PaddleBillingProvider },
    { provide: ENTITLEMENT_REPOSITORY, useClass: DrizzleEntitlementRepository },
  ],
})
export class BillingModule {}
