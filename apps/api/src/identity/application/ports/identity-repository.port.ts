import type {
  EntitlementRow,
  MembershipWithWorkspace,
  OnboardingCompleteInput,
  ProvisionedIdentity,
  ProvisionInput,
  SubscriptionRow,
  UserWithMemberships,
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
  /** Phase 15C — GET /me steady-state fast path: user + all memberships in one transaction. `undefined` = not yet provisioned. */
  loadUserWithMemberships(userId: string): Promise<UserWithMemberships | undefined>;
  listMemberships(userId: string): Promise<MembershipWithWorkspace[]>;
  findMembership(workspaceId: string, userId: string): Promise<MembershipWithWorkspace | undefined>;
  completeOnboarding(input: OnboardingCompleteInput): Promise<WorkspaceRow>;
  /** Phase 8 — the workspace's current commercial state, for `GET /me/workspaces/:id/context`'s `subscriptionState` field. */
  findSubscriptionByWorkspaceId(workspaceId: string): Promise<SubscriptionRow | undefined>;
  /** Phase 8 — the workspace's CURRENT entitlement snapshot (ALLOWED capabilities only — a caller only needs to know what it CAN do), for the same response's `entitlements` field. */
  listAllowedEntitlementsForWorkspace(workspaceId: string): Promise<EntitlementRow[]>;
}

export const IDENTITY_REPOSITORY = Symbol("IDENTITY_REPOSITORY");
