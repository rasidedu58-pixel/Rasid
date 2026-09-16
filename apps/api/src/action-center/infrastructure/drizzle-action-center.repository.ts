import { Injectable } from "@nestjs/common";
import { getCurrentMonth, getNextSession, listMissedSessions, listSessionsWithMissingRecords, loadActionCenterData, withRuntimeContext, type ActionCenterData, type ActionCenterDataParams, type CurrentMonthRef, type MissedSessionItem, type MissingRecordsSessionItem, type NextSessionItem } from "@academic-precision/database";
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

  listSessionsWithMissingRecords(workspaceId: string, visibleGroupIds: "ALL" | string[], limit: number, now?: Date): Promise<MissingRecordsSessionItem[]> {
    return withRuntimeContext(this.runtimeCtx(workspaceId), (db) => listSessionsWithMissingRecords(db, workspaceId, visibleGroupIds, limit, undefined, now));
  }

  listMissedSessions(workspaceId: string, visibleGroupIds: "ALL" | string[], limit: number, now: Date): Promise<MissedSessionItem[]> {
    return withRuntimeContext(this.runtimeCtx(workspaceId), (db) => listMissedSessions(db, workspaceId, visibleGroupIds, limit, now));
  }

  getNextSession(workspaceId: string, visibleGroupIds: "ALL" | string[], now: Date): Promise<NextSessionItem | undefined> {
    return withRuntimeContext(this.runtimeCtx(workspaceId), (db) => getNextSession(db, workspaceId, visibleGroupIds, now));
  }

  /** Phase 15C — all requested sections in ONE transaction (BEGIN/set_config/COMMIT once). */
  loadActionCenterData(params: ActionCenterDataParams): Promise<ActionCenterData> {
    return withRuntimeContext(this.runtimeCtx(params.workspaceId), (db) => loadActionCenterData(db, params));
  }
}
