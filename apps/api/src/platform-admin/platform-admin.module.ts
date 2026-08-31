import { Module } from "@nestjs/common";
import { SupabaseAuthGuard } from "../identity/api/guards/supabase-auth.guard";
import { JwtTokenVerifier, TOKEN_VERIFIER } from "../identity/infrastructure/jwt-token-verifier";
import { PlatformAdminController } from "./api/platform-admin.controller";
import { PlatformOperationsController } from "./api/platform-operations.controller";
import { PlatformAdminGuard } from "./api/guards/platform-admin.guard";
import { PlatformPermissionGuard } from "./api/guards/platform-permission.guard";
import { PlatformAdminService } from "./application/platform-admin.service";
import { PlatformOperationsService } from "./application/platform-operations.service";
import { PlatformStatusService } from "./application/platform-status.service";

/**
 * Phase 12 — Rasid Platform Admin. `SupabaseAuthGuard`/`TOKEN_VERIFIER`
 * re-provided directly (not imported from IdentityModule) — same avoid-a-
 * module-cycle convention as `TeamModule` (see that module's own comment).
 * No repository port/adapter pair here, unlike every other module:
 * `PlatformAdminService` calls `@academic-precision/database`'s exported
 * repository functions directly — they already encapsulate which
 * connection (`app_runtime` vs the dedicated `app_platform_admin`) each
 * query must run on, and there is no in-memory-fake test double for this
 * module yet (deliberate V1 scope choice, see the closure report).
 */
@Module({
  controllers: [PlatformAdminController, PlatformOperationsController],
  providers: [
    PlatformAdminService,
    PlatformOperationsService,
    PlatformStatusService,
    PlatformAdminGuard,
    PlatformPermissionGuard,
    SupabaseAuthGuard,
    { provide: TOKEN_VERIFIER, useClass: JwtTokenVerifier },
  ],
})
export class PlatformAdminModule {}
