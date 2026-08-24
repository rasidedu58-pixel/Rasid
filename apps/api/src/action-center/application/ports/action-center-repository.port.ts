import type { CurrentMonthRef, MissingRecordsSessionItem, NextSessionItem } from "@academic-precision/database";

/** Minimal, module-local port for the queries not already owned by another module's repository (Finance/Attention/Billing are re-provided directly instead of duplicated here). */
export interface ActionCenterRepositoryPort {
  getCurrentMonth(workspaceId: string): Promise<CurrentMonthRef | undefined>;
  listSessionsWithMissingRecords(workspaceId: string, visibleGroupIds: "ALL" | string[], limit: number): Promise<MissingRecordsSessionItem[]>;
  getNextSession(workspaceId: string, visibleGroupIds: "ALL" | string[], now: Date): Promise<NextSessionItem | undefined>;
}

export const ACTION_CENTER_REPOSITORY = Symbol("ACTION_CENTER_REPOSITORY");
