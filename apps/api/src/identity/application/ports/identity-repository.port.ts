import type {
  MembershipWithWorkspace,
  OnboardingCompleteInput,
  ProvisionedIdentity,
  ProvisionInput,
  WorkspaceRow,
} from "@academic-precision/database";

/**
 * Port (dependency-inversion boundary) between the identity application
 * layer and its persistence. `DrizzleIdentityRepository` is the real
 * implementation; tests may supply an in-memory fake without touching a
 * live database.
 */
export interface IdentityRepositoryPort {
  provision(input: ProvisionInput): Promise<ProvisionedIdentity>;
  listMemberships(userId: string): Promise<MembershipWithWorkspace[]>;
  findMembership(workspaceId: string, userId: string): Promise<MembershipWithWorkspace | undefined>;
  completeOnboarding(input: OnboardingCompleteInput): Promise<WorkspaceRow>;
}

export const IDENTITY_REPOSITORY = Symbol("IDENTITY_REPOSITORY");
