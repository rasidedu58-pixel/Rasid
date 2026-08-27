import { Injectable } from "@nestjs/common";
import { findGroupById, findGroupIdsInWorkspace, withRuntimeContext } from "@academic-precision/database";
import { getContext } from "@academic-precision/observability";
import type { GroupOwnershipPort } from "../application/ports/group-ownership.port";

/**
 * Real (PostgreSQL/Drizzle) implementation of {@link GroupOwnershipPort} —
 * Phase 3 replaces the Phase 2 `AlwaysTrueGroupOwnershipAdapter` stub now
 * that the real `groups` table exists (see
 * packages/database/src/schema/groups.ts). The port's contract
 * (`isGroupInWorkspace`) is unchanged — only this binding, in
 * `team.module.ts`, was swapped.
 *
 * Queries the actual `groups` table: `SELECT 1 FROM groups WHERE id = $1
 * AND workspace_id = $2`, expressed via the typed `findGroupById` helper +
 * an explicit workspace_id comparison (rather than relying solely on RLS,
 * since this may be called before `RequestContextInterceptor` sets ambient
 * ExecutionContext — see `withRuntimeContext` usage below).
 */
@Injectable()
export class DrizzleGroupOwnershipAdapter implements GroupOwnershipPort {
  async isGroupInWorkspace(groupId: string, workspaceId: string): Promise<boolean> {
    const ctx = getContext();
    const group = await withRuntimeContext({ userId: ctx?.userId, workspaceId }, (db) =>
      findGroupById(db, groupId),
    );
    return !!group && group.workspaceId === workspaceId;
  }

  /** Phase 15D.1 — one query for the whole set (replaces per-id isGroupInWorkspace). */
  async findGroupIdsInWorkspace(groupIds: string[], workspaceId: string): Promise<Set<string>> {
    if (groupIds.length === 0) return new Set();
    const ctx = getContext();
    const found = await withRuntimeContext({ userId: ctx?.userId, workspaceId }, (db) =>
      findGroupIdsInWorkspace(db, groupIds, workspaceId),
    );
    return new Set(found);
  }
}
