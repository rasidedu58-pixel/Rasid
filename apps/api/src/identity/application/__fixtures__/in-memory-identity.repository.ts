import { randomUUID } from "node:crypto";
import type {
  EntitlementRow,
  MembershipWithWorkspace,
  OnboardingCompleteInput,
  ProvisionedIdentity,
  ProvisionInput,
  SubscriptionRow,
  WorkspaceRow,
} from "@academic-precision/database";
import { resolveEntitlementSnapshot, type Capability } from "@academic-precision/database";
import type { IdentityRepositoryPort } from "../ports/identity-repository.port";

/**
 * In-memory test double for IdentityRepositoryPort. Mirrors the same
 * idempotent-provisioning contract as the real Drizzle repository (calling
 * `provision` twice for the same authUserId never creates a second
 * user/workspace/membership) without requiring a live database — used by
 * unit tests per the Phase 1 prompt's "no live Postgres in CI" guidance.
 */
export class InMemoryIdentityRepository implements IdentityRepositoryPort {
  private nextId = 1;
  readonly usersById = new Map<string, ProvisionedIdentity["user"]>();
  readonly workspacesByUserId = new Map<string, ProvisionedIdentity["workspace"]>();
  readonly membershipsByUserId = new Map<string, ProvisionedIdentity["membership"]>();
  readonly subscriptionsByWorkspaceId = new Map<string, SubscriptionRow>();
  readonly entitlementsByWorkspaceId = new Map<string, EntitlementRow[]>();

  private newId(): string {
    return `test-id-${this.nextId++}`;
  }

  /** Mirrors `provisionSubscriptionForNewWorkspaceTransaction` (packages/database) for a fresh in-memory workspace — always grants a 14-day TRIAL (the fixture has no cross-test `owner_trial_grants` concept; anti-abuse behavior itself is covered separately by the live integration suite). */
  private seedTrialSubscription(workspaceId: string): void {
    const now = new Date();
    const periodEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const subscription: SubscriptionRow = {
      id: randomUUID(),
      workspaceId,
      provider: "PADDLE",
      providerCustomerId: null,
      providerSubscriptionId: null,
      state: "TRIAL",
      periodStart: now,
      periodEnd,
      cancelAtPeriodEnd: false,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    this.subscriptionsByWorkspaceId.set(workspaceId, subscription);

    const snapshot = resolveEntitlementSnapshot("TRIAL");
    const rows: EntitlementRow[] = (Object.keys(snapshot) as Capability[]).map((capability) => ({
      id: randomUUID(),
      workspaceId,
      capability,
      state: snapshot[capability],
      sourceType: "TRIAL",
      sourceId: subscription.id,
      effectiveFrom: now,
      effectiveTo: null,
      createdAt: now,
      updatedAt: now,
    }));
    this.entitlementsByWorkspaceId.set(workspaceId, rows);
  }

  async provision(input: ProvisionInput): Promise<ProvisionedIdentity> {
    const existingUser = this.usersById.get(input.authUserId);
    if (existingUser) {
      const workspace = this.workspacesByUserId.get(input.authUserId);
      const membership = this.membershipsByUserId.get(input.authUserId);
      if (!workspace || !membership) {
        throw new Error("Inconsistent in-memory fixture state.");
      }
      return { user: existingUser, workspace, membership };
    }

    const now = new Date();
    const user: ProvisionedIdentity["user"] = {
      id: input.authUserId,
      fullName: input.fullName,
      emailDisplay: input.email,
      phone: null,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    };
    const workspace: ProvisionedIdentity["workspace"] = {
      id: this.newId(),
      ownerUserId: user.id,
      name: input.fullName,
      workspaceType: "TEACHER",
      locale: "ar-EG",
      timezone: "Africa/Cairo",
      dueDatePolicy: "PER_GROUP",
      unifiedDueDay: null,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };
    const membership: ProvisionedIdentity["membership"] = {
      id: this.newId(),
      workspaceId: workspace.id,
      userId: user.id,
      roleLabel: "OWNER",
      status: "ACTIVE",
      joinedAt: now,
      disabledAt: null,
      createdAt: now,
      updatedAt: now,
    };

    this.usersById.set(user.id, user);
    this.workspacesByUserId.set(user.id, workspace);
    this.membershipsByUserId.set(user.id, membership);
    this.seedTrialSubscription(workspace.id);

    return { user, workspace, membership };
  }

  async listMemberships(userId: string): Promise<MembershipWithWorkspace[]> {
    const membership = this.membershipsByUserId.get(userId);
    const workspace = this.workspacesByUserId.get(userId);
    if (!membership || !workspace) {
      return [];
    }
    return [{ membership, workspace }];
  }

  async findMembership(
    workspaceId: string,
    userId: string,
  ): Promise<MembershipWithWorkspace | undefined> {
    const membership = this.membershipsByUserId.get(userId);
    const workspace = this.workspacesByUserId.get(userId);
    if (!membership || !workspace || workspace.id !== workspaceId) {
      return undefined;
    }
    return { membership, workspace };
  }

  async completeOnboarding(input: OnboardingCompleteInput): Promise<WorkspaceRow> {
    for (const [userId, workspace] of this.workspacesByUserId.entries()) {
      if (workspace.id === input.workspaceId) {
        const updated: WorkspaceRow = {
          ...workspace,
          name: input.displayName,
          dueDatePolicy: input.dueDatePolicy,
          unifiedDueDay: input.unifiedDueDay,
          updatedAt: new Date(),
        };
        this.workspacesByUserId.set(userId, updated);
        return updated;
      }
    }
    throw new Error(`Workspace ${input.workspaceId} not found in fixture.`);
  }

  /** Test helper: seed a membership directly (bypassing provision), e.g. a non-owner role. */
  seedMembership(
    userId: string,
    overrides: Partial<ProvisionedIdentity["membership"]> = {},
    workspaceOverrides: Partial<ProvisionedIdentity["workspace"]> = {},
  ): void {
    const now = new Date();
    const workspace: ProvisionedIdentity["workspace"] = {
      id: this.newId(),
      ownerUserId: userId,
      name: "Seeded workspace",
      workspaceType: "TEACHER",
      locale: "ar-EG",
      timezone: "Africa/Cairo",
      dueDatePolicy: "PER_GROUP",
      unifiedDueDay: null,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      ...workspaceOverrides,
    };
    const membership: ProvisionedIdentity["membership"] = {
      id: this.newId(),
      workspaceId: workspace.id,
      userId,
      roleLabel: "ASSISTANT",
      status: "ACTIVE",
      joinedAt: now,
      disabledAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
    this.usersById.set(userId, {
      id: userId,
      fullName: "Seeded user",
      emailDisplay: null,
      phone: null,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    });
    this.workspacesByUserId.set(userId, workspace);
    this.membershipsByUserId.set(userId, membership);
    this.seedTrialSubscription(workspace.id);
  }

  async findSubscriptionByWorkspaceId(workspaceId: string): Promise<SubscriptionRow | undefined> {
    return this.subscriptionsByWorkspaceId.get(workspaceId);
  }

  async listAllowedEntitlementsForWorkspace(workspaceId: string): Promise<EntitlementRow[]> {
    return (this.entitlementsByWorkspaceId.get(workspaceId) ?? []).filter((e) => e.state === "ALLOWED");
  }
}
