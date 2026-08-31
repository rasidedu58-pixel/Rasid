import type {
  EntitlementRow,
  MembershipWithWorkspace,
  OnboardingCompleteInput,
  ProvisionedIdentity,
  ProvisionInput,
  SubscriptionRow,
  UserRow,
  UserWithMemberships,
  WorkspaceCommercialState,
  WorkspaceRow,
} from "@academic-precision/database";
import type { PlatformRole } from "@academic-precision/contracts";

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
  /** Is this user a Rasid platform-staff member (row in `platform_admins`)? Read-only signal for the `/me` `platform.isStaff` flag. */
  isPlatformStaff(userId: string): Promise<boolean>;
  /** The user's platform-ops role, or null if not staff. Drives `/me`'s `platform.role` (UI gating; server still enforces per-permission). */
  getPlatformRole(userId: string): Promise<PlatformRole | null>;
  findMembership(workspaceId: string, userId: string): Promise<MembershipWithWorkspace | undefined>;
  completeOnboarding(input: OnboardingCompleteInput): Promise<WorkspaceRow>;
  /** Teacher profile edit (Step-2 onboarding + settings) — updates the caller's OWN row under the users_self_update RLS policy. */
  updateProfile(
    userId: string,
    patch: { fullName?: string; phone?: string; governorate?: string; subject?: string; subjectOther?: string | null },
  ): Promise<UserRow | undefined>;
  /** Phase 8 — the workspace's current commercial state, for `GET /me/workspaces/:id/context`'s `subscriptionState` field. */
  findSubscriptionByWorkspaceId(workspaceId: string): Promise<SubscriptionRow | undefined>;
  /** Phase 8 — the workspace's CURRENT entitlement snapshot (ALLOWED capabilities only — a caller only needs to know what it CAN do), for the same response's `entitlements` field. */
  listAllowedEntitlementsForWorkspace(workspaceId: string): Promise<EntitlementRow[]>;
  /** Phase 15C — subscription + allowed entitlements in ONE transaction, for `GET /me/workspaces/:id/context`. */
  loadWorkspaceCommercialState(workspaceId: string): Promise<WorkspaceCommercialState>;
}

export const IDENTITY_REPOSITORY = Symbol("IDENTITY_REPOSITORY");
