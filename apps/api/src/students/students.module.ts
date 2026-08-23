import { Module } from "@nestjs/common";
import { SupabaseAuthGuard } from "../identity/api/guards/supabase-auth.guard";
import { JwtTokenVerifier, TOKEN_VERIFIER } from "../identity/infrastructure/jwt-token-verifier";
import { PermissionGuard } from "../team/api/guards/permission.guard";
import { PermissionResolverService } from "../team/application/permission-resolver.service";
import { GROUP_OWNERSHIP_PORT } from "../team/application/ports/group-ownership.port";
import { TEAM_REPOSITORY } from "../team/application/ports/team-repository.port";
import { DrizzleTeamRepository } from "../team/infrastructure/drizzle-team.repository";
import { DrizzleGroupOwnershipAdapter } from "../team/infrastructure/group-ownership.adapter";
import { PreviewTokenService } from "../scheduling/application/preview-token.service";
import { StudentsController } from "./api/students.controller";
import { EnrollmentsController } from "./api/enrollments.controller";
import { QrController } from "./api/qr.controller";
import { StudentsService } from "./application/students.service";
import { EnrollmentsService } from "./application/enrollments.service";
import { STUDENTS_REPOSITORY } from "./application/ports/students-repository.port";
import { DrizzleStudentsRepository } from "./infrastructure/drizzle-students.repository";

/**
 * Phase 4 — Students / Guardians / QR / Enrollment module. Mirrors
 * `SchedulingModule`'s pattern of re-providing `SupabaseAuthGuard`/
 * `TOKEN_VERIFIER`/`PermissionGuard` + dependencies directly (rather than
 * importing `IdentityModule`/`TeamModule`) to avoid a module cycle, since
 * neither exports its providers. Also re-provides `PreviewTokenService`
 * directly (rather than importing `SchedulingModule`, same reasoning) —
 * enrollment preview/apply reuses the exact same one-time, server-side
 * preview-token mechanism Phase 3 established.
 */
@Module({
  controllers: [StudentsController, EnrollmentsController, QrController],
  providers: [
    StudentsService,
    EnrollmentsService,
    PreviewTokenService,
    PermissionResolverService,
    PermissionGuard,
    SupabaseAuthGuard,
    { provide: TOKEN_VERIFIER, useClass: JwtTokenVerifier },
    { provide: TEAM_REPOSITORY, useClass: DrizzleTeamRepository },
    { provide: GROUP_OWNERSHIP_PORT, useClass: DrizzleGroupOwnershipAdapter },
    { provide: STUDENTS_REPOSITORY, useClass: DrizzleStudentsRepository },
  ],
})
export class StudentsModule {}
