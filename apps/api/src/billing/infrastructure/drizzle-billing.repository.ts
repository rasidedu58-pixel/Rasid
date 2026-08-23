import { Injectable } from "@nestjs/common";
import {
  completeIdempotencyRecord,
  failIdempotencyRecord,
  findCurrentEntitlement,
  findIdempotencyRecord,
  findSubscriptionByWorkspaceId,
  listCurrentEntitlementsForWorkspace,
  tryInsertIdempotencyRecord,
  updateSubscriptionStateTransaction,
  withRuntimeContext,
  type Capability,
  type EntitlementRow,
  type IdempotencyRecordRow,
  type SubscriptionRow,
  type UpdateSubscriptionStateInput,
} from "@academic-precision/database";
import { getContext } from "@academic-precision/observability";
import type { BillingRepositoryPort } from "../application/ports/billing-repository.port";

@Injectable()
export class DrizzleBillingRepository implements BillingRepositoryPort {
  private runtimeCtx(workspaceId?: string) {
    const ctx = getContext();
    return { userId: ctx?.userId, workspaceId: workspaceId ?? (ctx?.workspaceId as string | undefined) };
  }

  findSubscriptionByWorkspaceId(workspaceId: string): Promise<SubscriptionRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(workspaceId), (db) => findSubscriptionByWorkspaceId(db, workspaceId));
  }

  updateSubscriptionStateTransaction(
    input: UpdateSubscriptionStateInput,
  ): Promise<SubscriptionRow | "SUBSCRIPTION_VERSION_CONFLICT"> {
    // `input.workspaceId` is explicit (never inferred from ambient
    // context) — required for the webhook path, which has no authenticated
    // request/PermissionGuard-derived workspace context at all (see
    // UpdateSubscriptionStateInput's own doc comment).
    return withRuntimeContext(this.runtimeCtx(input.workspaceId), (db) => updateSubscriptionStateTransaction(db, input));
  }

  listCurrentEntitlementsForWorkspace(workspaceId: string): Promise<EntitlementRow[]> {
    return withRuntimeContext(this.runtimeCtx(workspaceId), (db) => listCurrentEntitlementsForWorkspace(db, workspaceId));
  }

  async findCurrentEntitlementState(workspaceId: string, capability: Capability): Promise<EntitlementRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(workspaceId), (db) => findCurrentEntitlement(db, workspaceId, capability));
  }

  findIdempotencyRecord(workspaceId: string, operation: string, key: string): Promise<IdempotencyRecordRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(workspaceId), (db) => findIdempotencyRecord(db, workspaceId, operation, key));
  }

  tryInsertIdempotencyRecord(input: {
    workspaceId: string;
    operation: string;
    key: string;
    requestHash: string;
    expiresAt: Date;
  }): Promise<IdempotencyRecordRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(input.workspaceId), (db) => tryInsertIdempotencyRecord(db, input));
  }

  completeIdempotencyRecord(id: string, responseCode: number, responsePayload: unknown): Promise<void> {
    return withRuntimeContext(this.runtimeCtx(), (db) => completeIdempotencyRecord(db, id, responseCode, responsePayload));
  }

  failIdempotencyRecord(id: string): Promise<void> {
    return withRuntimeContext(this.runtimeCtx(), (db) => failIdempotencyRecord(db, id));
  }
}
