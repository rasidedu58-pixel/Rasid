import { Injectable } from "@nestjs/common";
import {
  countUnreadForUser,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead,
  withRuntimeContext,
  type NotificationRow,
} from "@academic-precision/database";
import { getContext } from "@academic-precision/observability";
import type { NotificationsRepositoryPort } from "../application/ports/notifications-repository.port";

@Injectable()
export class DrizzleNotificationsRepository implements NotificationsRepositoryPort {
  private runtimeCtx(workspaceId?: string) {
    const ctx = getContext();
    return { userId: ctx?.userId, workspaceId: workspaceId ?? (ctx?.workspaceId as string | undefined) };
  }

  listForUser(workspaceId: string, userId: string): Promise<NotificationRow[]> {
    return withRuntimeContext(this.runtimeCtx(workspaceId), (db) => listNotificationsForUser(db, { workspaceId, userId }));
  }

  countUnreadForUser(workspaceId: string, userId: string): Promise<number> {
    return withRuntimeContext(this.runtimeCtx(workspaceId), (db) => countUnreadForUser(db, { workspaceId, userId }));
  }

  markRead(workspaceId: string, userId: string, id: string): Promise<boolean> {
    return withRuntimeContext(this.runtimeCtx(workspaceId), (db) => markNotificationRead(db, { workspaceId, userId, id }));
  }

  markAllRead(workspaceId: string, userId: string): Promise<number> {
    return withRuntimeContext(this.runtimeCtx(workspaceId), (db) => markAllNotificationsRead(db, { workspaceId, userId }));
  }
}
