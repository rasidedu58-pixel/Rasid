import { Injectable } from "@nestjs/common";
import {
  completeOnboarding,
  createUserWorkspaceMembership,
  findMembership,
  getDb,
  listMembershipsForUser,
  type MembershipWithWorkspace,
  type OnboardingCompleteInput,
  type ProvisionedIdentity,
  type ProvisionInput,
  type WorkspaceRow,
} from "@academic-precision/database";
import type { IdentityRepositoryPort } from "../application/ports/identity-repository.port";

/**
 * Real (PostgreSQL/Drizzle) implementation of {@link IdentityRepositoryPort}.
 * Thin adapter only — all persistence/transaction logic lives in
 * packages/database (single source of truth, reused by any future caller).
 */
@Injectable()
export class DrizzleIdentityRepository implements IdentityRepositoryPort {
  provision(input: ProvisionInput): Promise<ProvisionedIdentity> {
    return createUserWorkspaceMembership(getDb(), input);
  }

  listMemberships(userId: string): Promise<MembershipWithWorkspace[]> {
    return listMembershipsForUser(getDb(), userId);
  }

  findMembership(workspaceId: string, userId: string): Promise<MembershipWithWorkspace | undefined> {
    return findMembership(getDb(), workspaceId, userId);
  }

  completeOnboarding(input: OnboardingCompleteInput): Promise<WorkspaceRow> {
    return completeOnboarding(getDb(), input);
  }
}
