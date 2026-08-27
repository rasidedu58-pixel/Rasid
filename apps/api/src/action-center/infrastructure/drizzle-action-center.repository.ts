import { Injectable } from "@nestjs/common";
import { getCurrentMonth, getNextSession, listSessionsWithMissingRecords, loadActionCenterData, withRuntimeContext, type ActionCenterData, type ActionCenterDataParams, type CurrentMonthRef, type MissingRecordsSessionItem, type NextSessionItem } from "@academic-precision/database";
import { getContext } from "@academic-precision/observability";
import type { ActionCenterRepositoryPort } from "../application/ports/action-center-repository.port";

@Injectable()
export class DrizzleActionCenterRepository implements ActionCenterRepositoryPort {
  private runtimeCtx(workspaceId?: string) {
    const ctx = getContext();
    return { userId: ctx?.userId, workspaceId: workspaceId ?? (ctx?.workspaceId as string | undefined) };
  }

  getCurrentMonth(workspaceId: string): Promise<CurrentMonthRef | undefined> {
    return withRuntimeContext(this.runtimeCtx(workspaceId), (db) => getCurrentMonth(db, workspaceId));
  }

  listSessionsWithMissingRecords(workspaceId: string, visibleGroupIds: "ALL" | string[], limit: number): Promise<MissingRecordsSessionItem[]> {
    return withRuntimeContext(this.runtimeCtx(workspaceId), (db) => listSessionsWithMissingRecords(db, workspaceId, visibleGroupIds, limit));
  }

  getNextSession(workspaceId: string, visibleGroupIds: "ALL" | string[], now: Date): Promise<NextSessionItem | undefined> {
    return withRuntimeContext(this.runtimeCtx(workspaceId), (db) => getNextSession(db, workspaceId, visibleGroupIds, now));
  }

  /** Phase 15C — all requested sections in ONE transaction (BEGIN/set_config/COMMIT once). */
  loadActionCenterData(params: ActionCenterDataParams): Promise<ActionCenterData> {
    return withRuntimeContext(this.runtimeCtx(params.workspaceId), (db) => loadActionCenterData(db, params));
  }
}
