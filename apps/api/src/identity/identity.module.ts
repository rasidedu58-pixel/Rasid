import { Module } from "@nestjs/common";
import { IdentityController } from "./api/identity.controller";
import { SupabaseAuthGuard } from "./api/guards/supabase-auth.guard";
import { IdentityService } from "./application/identity.service";
import { IDENTITY_REPOSITORY } from "./application/ports/identity-repository.port";
import { DrizzleIdentityRepository } from "./infrastructure/drizzle-identity.repository";
import { JwtTokenVerifier, TOKEN_VERIFIER } from "./infrastructure/jwt-token-verifier";

@Module({
  controllers: [IdentityController],
  providers: [
    IdentityService,
    SupabaseAuthGuard,
    { provide: IDENTITY_REPOSITORY, useClass: DrizzleIdentityRepository },
    { provide: TOKEN_VERIFIER, useClass: JwtTokenVerifier },
  ],
})
export class IdentityModule {}
