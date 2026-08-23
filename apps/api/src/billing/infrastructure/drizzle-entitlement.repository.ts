import { Injectable } from "@nestjs/common";
import { findCurrentEntitlement, withRuntimeContext, type Capability, type EntitlementState } from "@academic-precision/database";
import { getContext } from "@academic-precision/observability";
import type { EntitlementRepositoryPort } from "../application/ports/entitlement-repository.port";

@Injectable()
export class DrizzleEntitlementRepository implements EntitlementRepositoryPort {
  async findCurrentEntitlementState(workspaceId: string, capability: Capability): Promise<EntitlementState | undefined> {
    const ctx = getContext();
    const row = await withRuntimeContext({ userId: ctx?.userId, workspaceId }, (db) =>
      findCurrentEntitlement(db, workspaceId, capability),
    );
    return row?.state as EntitlementState | undefined;
  }
}
