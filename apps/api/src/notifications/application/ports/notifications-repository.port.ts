import type { NotificationRow } from "@academic-precision/database";

export interface NotificationsRepositoryPort {
  listForUser(workspaceId: string, userId: string): Promise<NotificationRow[]>;
  countUnreadForUser(workspaceId: string, userId: string): Promise<number>;
  markRead(workspaceId: string, userId: string, id: string): Promise<boolean>;
  markAllRead(workspaceId: string, userId: string): Promise<number>;
}

export const NOTIFICATIONS_REPOSITORY = Symbol("NOTIFICATIONS_REPOSITORY");
