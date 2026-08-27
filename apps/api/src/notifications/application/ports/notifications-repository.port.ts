import type { NotificationRow, NotificationsPage } from "@academic-precision/database";

export interface NotificationsRepositoryPort {
  listForUser(workspaceId: string, userId: string): Promise<NotificationRow[]>;
  countUnreadForUser(workspaceId: string, userId: string): Promise<number>;
  /** Phase 15C — rows + unread count in ONE transaction (replaces two separate list/count transactions on the read path). */
  loadPage(workspaceId: string, userId: string): Promise<NotificationsPage>;
  markRead(workspaceId: string, userId: string, id: string): Promise<boolean>;
  markAllRead(workspaceId: string, userId: string): Promise<number>;
}

export const NOTIFICATIONS_REPOSITORY = Symbol("NOTIFICATIONS_REPOSITORY");
