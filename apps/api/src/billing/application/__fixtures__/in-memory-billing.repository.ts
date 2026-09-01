import { randomUUID } from "node:crypto";
import {
  resolveEntitlementSnapshot,
  type Capability,
  type EntitlementRow,
  type IdempotencyRecordRow,
  type SubscriptionRow,
  type SubscriptionState,
  type UpdateSubscriptionStateInput,
} from "@academic-precision/database";
import type { BillingRepositoryPort } from "../ports/billing-repository.port";

/**
 * In-memory test double for {@link BillingRepositoryPort} — mirrors
 * `InMemoryFinanceRepository`/`InMemoryAttentionRepository` (Phase 6/7):
 * no live Postgres needed for unit tests, but preserves the same
 * transactional/optimistic-concurrency/append-only semantics as the real
 * Drizzle repository.
 */
export class InMemoryBillingRepository implements BillingRepositoryPort {
  readonly subscriptionsById = new Map<string, SubscriptionRow>();
  readonly subscriptionsByWorkspaceId = new Map<string, string>(); // workspaceId -> subscriptionId
  readonly entitlementsByWorkspaceId = new Map<string, EntitlementRow[]>(); // append-only history, newest last
  readonly idempotencyById = new Map<string, IdempotencyRecordRow>();

  private now(): Date {
    return new Date();
  }

  // ---- seeding helpers -----------------------------------------------

  seedSubscription(input: Partial<SubscriptionRow> & { workspaceId: string; state: SubscriptionState }): SubscriptionRow {
    const now = this.now();
    const row: SubscriptionRow = {
      id: input.id ?? randomUUID(),
      workspaceId: input.workspaceId,
      provider: input.provider ?? "PADDLE",
      providerCustomerId: input.providerCustomerId ?? null,
      providerSubscriptionId: input.providerSubscriptionId ?? null,
      state: input.state,
      periodStart: input.periodStart ?? now,
      periodEnd: input.periodEnd ?? now,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
      planCode: input.planCode ?? null,
      billingCycle: input.billingCycle ?? null,
      customMaxActiveStudents: input.customMaxActiveStudents ?? null,
      customMaxTeamMembers: input.customMaxTeamMembers ?? null,
      currentPriceMinor: input.currentPriceMinor ?? null,
      priceCurrencyCode: input.priceCurrencyCode ?? null,
      planPriceVersion: input.planPriceVersion ?? null,
      pendingPlanCode: input.pendingPlanCode ?? null,
      pendingBillingCycle: input.pendingBillingCycle ?? null,
      pendingChangeRequestedAt: input.pendingChangeRequestedAt ?? null,
      pendingChangeRequestedBy: input.pendingChangeRequestedBy ?? null,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      version: input.version ?? 1,
    };
    this.subscriptionsById.set(row.id, row);
    this.subscriptionsByWorkspaceId.set(row.workspaceId, row.id);
    this.appendEntitlementSnapshot(row.workspaceId, input.state, "SUBSCRIPTION", row.id);
    return row;
  }

  private appendEntitlementSnapshot(workspaceId: string, state: SubscriptionState, sourceType: "SUBSCRIPTION" | "TRIAL" | "ADMIN", sourceId: string | null): void {
    const now = this.now();
    const snapshot = resolveEntitlementSnapshot(state);
    const rows: EntitlementRow[] = (Object.keys(snapshot) as Capability[]).map((capability) => ({
      id: randomUUID(),
      workspaceId,
      capability,
      state: snapshot[capability],
      sourceType,
      sourceId,
      effectiveFrom: now,
      effectiveTo: null,
      createdAt: now,
      updatedAt: now,
    }));
    const existing = this.entitlementsByWorkspaceId.get(workspaceId) ?? [];
    this.entitlementsByWorkspaceId.set(workspaceId, [...existing, ...rows]);
  }

  // ---- BillingRepositoryPort -------------------------------------------

  async findSubscriptionByWorkspaceId(workspaceId: string): Promise<SubscriptionRow | undefined> {
    const id = this.subscriptionsByWorkspaceId.get(workspaceId);
    return id ? this.subscriptionsById.get(id) : undefined;
  }

  async updateSubscriptionStateTransaction(
    input: UpdateSubscriptionStateInput,
  ): Promise<SubscriptionRow | "SUBSCRIPTION_VERSION_CONFLICT"> {
    const existing = this.subscriptionsById.get(input.id);
    if (!existing || existing.version !== input.expectedVersion) return "SUBSCRIPTION_VERSION_CONFLICT";

    const now = this.now();
    const updated: SubscriptionRow = {
      ...existing,
      state: input.nextState,
      periodStart: input.periodStart ?? existing.periodStart,
      periodEnd: input.periodEnd ?? existing.periodEnd,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? existing.cancelAtPeriodEnd,
      providerSubscriptionId: input.providerSubscriptionId ?? existing.providerSubscriptionId,
      providerCustomerId: input.providerCustomerId ?? existing.providerCustomerId,
      updatedAt: now,
      version: existing.version + 1,
    };
    this.subscriptionsById.set(updated.id, updated);
    this.appendEntitlementSnapshot(updated.workspaceId, input.nextState, input.sourceType, input.sourceId);
    return updated;
  }

  async listCurrentEntitlementsForWorkspace(workspaceId: string): Promise<EntitlementRow[]> {
    const rows = this.entitlementsByWorkspaceId.get(workspaceId) ?? [];
    const seen = new Set<string>();
    const current: EntitlementRow[] = [];
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i]!;
      if (seen.has(row.capability)) continue;
      seen.add(row.capability);
      current.push(row);
    }
    return current;
  }

  async findCurrentEntitlementState(workspaceId: string, capability: Capability): Promise<EntitlementRow | undefined> {
    const current = await this.listCurrentEntitlementsForWorkspace(workspaceId);
    return current.find((r) => r.capability === capability);
  }

  async findIdempotencyRecord(workspaceId: string, operation: string, key: string): Promise<IdempotencyRecordRow | undefined> {
    return [...this.idempotencyById.values()].find(
      (r) => r.workspaceId === workspaceId && r.operation === operation && r.key === key,
    );
  }

  async tryInsertIdempotencyRecord(input: {
    workspaceId: string;
    operation: string;
    key: string;
    requestHash: string;
    expiresAt: Date;
  }): Promise<IdempotencyRecordRow | undefined> {
    const existing = await this.findIdempotencyRecord(input.workspaceId, input.operation, input.key);
    if (existing) return undefined;
    const now = this.now();
    const row: IdempotencyRecordRow = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      operation: input.operation,
      key: input.key,
      requestHash: input.requestHash,
      status: "IN_PROGRESS",
      responseCode: null,
      responsePayload: null,
      createdAt: now,
      updatedAt: now,
      expiresAt: input.expiresAt,
    };
    this.idempotencyById.set(row.id, row);
    return row;
  }

  async completeIdempotencyRecord(id: string, responseCode: number, responsePayload: unknown): Promise<void> {
    const existing = this.idempotencyById.get(id);
    if (!existing) return;
    this.idempotencyById.set(id, {
      ...existing,
      status: "COMPLETED",
      responseCode,
      responsePayload: responsePayload as never,
      updatedAt: this.now(),
    });
  }

  async failIdempotencyRecord(id: string): Promise<void> {
    const existing = this.idempotencyById.get(id);
    if (!existing) return;
    this.idempotencyById.set(id, { ...existing, status: "FAILED_RETRYABLE", updatedAt: this.now() });
  }
}
