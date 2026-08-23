import type {
  Capability,
  EntitlementRow,
  IdempotencyRecordRow,
  SubscriptionRow,
  UpdateSubscriptionStateInput,
} from "@academic-precision/database";

/**
 * Port (dependency-inversion boundary) between the Billing application
 * layer and its persistence — mirrors the Phase 1-7 convention exactly.
 * `DrizzleBillingRepository` is the real implementation; tests supply an
 * in-memory fake.
 */
export interface BillingRepositoryPort {
  /**
   * Note: there is deliberately NO `findSubscriptionByProviderSubscriptionId`
   * on this port — resolving a webhook's workspace_id via a cross-workspace
   * lookup by provider id would need the SAME kind of broad, non-tenant-
   * scoped access the worker's `app_worker` role has for outbox/subscription
   * scanning, which `app_runtime` correctly does NOT have (and must not
   * gain just for this). Instead, `/billing/checkout` stashes
   * `custom_data: { workspaceId }` on the Paddle transaction/subscription
   * (`paddle-billing.provider.ts`), which Paddle echoes back on every
   * subsequent webhook for that subscription — the workspace is resolved
   * directly from the verified payload, never via a cross-tenant DB lookup.
   */
  findSubscriptionByWorkspaceId(workspaceId: string): Promise<SubscriptionRow | undefined>;
  updateSubscriptionStateTransaction(
    input: UpdateSubscriptionStateInput,
  ): Promise<SubscriptionRow | "SUBSCRIPTION_VERSION_CONFLICT">;
  listCurrentEntitlementsForWorkspace(workspaceId: string): Promise<EntitlementRow[]>;
  findCurrentEntitlementState(workspaceId: string, capability: Capability): Promise<EntitlementRow | undefined>;

  // Idempotency (shared table/mechanism with every prior phase's transactional writes).
  findIdempotencyRecord(workspaceId: string, operation: string, key: string): Promise<IdempotencyRecordRow | undefined>;
  tryInsertIdempotencyRecord(input: {
    workspaceId: string;
    operation: string;
    key: string;
    requestHash: string;
    expiresAt: Date;
  }): Promise<IdempotencyRecordRow | undefined>;
  completeIdempotencyRecord(id: string, responseCode: number, responsePayload: unknown): Promise<void>;
  failIdempotencyRecord(id: string): Promise<void>;
}

export const BILLING_REPOSITORY = Symbol("BILLING_REPOSITORY");
