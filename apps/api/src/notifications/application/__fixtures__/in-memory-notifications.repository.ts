import { randomUUID } from "node:crypto";
import type { NotificationRow, NotificationsPage, NotificationType } from "@academic-precision/database";
import type { NotificationsRepositoryPort } from "../ports/notifications-repository.port";

export class InMemoryNotificationsRepository implements NotificationsRepositoryPort {
  readonly rows = new Map<string, NotificationRow>();

  seed(input: { workspaceId: string; userId: string; type: NotificationType; title: string; body: string; readAt?: Date | null }): NotificationRow {
    const row: NotificationRow = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      entityType: null,
      entityId: null,
      dedupKey: randomUUID(),
      readAt: input.readAt ?? null,
      createdAt: new Date(),
    };
    this.rows.set(row.id, row);
    return row;
  }

  async listForUser(workspaceId: string, userId: string): Promise<NotificationRow[]> {
    return [...this.rows.values()]
      .filter((r) => r.workspaceId === workspaceId && r.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async countUnreadForUser(workspaceId: string, userId: string): Promise<number> {
    return [...this.rows.values()].filter((r) => r.workspaceId === workspaceId && r.userId === userId && r.readAt === null).length;
  }

  loadPageCalls = 0;
  async loadPage(workspaceId: string, userId: string): Promise<NotificationsPage> {
    this.loadPageCalls += 1;
    const [rows, unreadCount] = await Promise.all([this.listForUser(workspaceId, userId), this.countUnreadForUser(workspaceId, userId)]);
    return { rows, unreadCount };
  }

  async markRead(workspaceId: string, userId: string, id: string): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.workspaceId !== workspaceId || row.userId !== userId || row.readAt !== null) return false;
    this.rows.set(id, { ...row, readAt: new Date() });
    return true;
  }

  async markAllRead(workspaceId: string, userId: string): Promise<number> {
    let count = 0;
    for (const row of this.rows.values()) {
      if (row.workspaceId === workspaceId && row.userId === userId && row.readAt === null) {
        this.rows.set(row.id, { ...row, readAt: new Date() });
        count += 1;
      }
    }
    return count;
  }
}
