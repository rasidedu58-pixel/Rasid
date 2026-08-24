import { Inject, Injectable } from "@nestjs/common";
import type {
  ListNotificationsResponse,
  MarkAllNotificationsReadResponse,
  MarkNotificationReadResponse,
  NotificationDto,
} from "@academic-precision/contracts";
import { ResourceNotFoundException } from "../../common/exceptions/api.exception";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import type { WorkspaceContext } from "../../team/api/guards/permission.guard";
import { NOTIFICATIONS_REPOSITORY, type NotificationsRepositoryPort } from "./ports/notifications-repository.port";

/**
 * Application service for Phase 9 in-app Notifications endpoints. Every
 * read/write here is ALREADY user-scoped both by `NotificationsRepositoryPort`
 * itself (the RLS `notifications_owner_access` policy requires BOTH
 * workspace_id AND user_id to match) and by the explicit `userId` parameter
 * passed to every call — belt-and-suspenders, matching the "RLS is not a
 * justification for writing unrestricted repository queries" rule (Database
 * Schema §16).
 */
@Injectable()
export class NotificationsService {
  constructor(@Inject(NOTIFICATIONS_REPOSITORY) private readonly repository: NotificationsRepositoryPort) {}

  async list(authUser: VerifiedSupabaseToken, workspaceContext: WorkspaceContext): Promise<ListNotificationsResponse> {
    const [rows, unreadCount] = await Promise.all([
      this.repository.listForUser(workspaceContext.workspaceId, authUser.id),
      this.repository.countUnreadForUser(workspaceContext.workspaceId, authUser.id),
    ]);
    return { notifications: rows.map((r) => this.toDto(r)), unreadCount };
  }

  async markRead(authUser: VerifiedSupabaseToken, workspaceContext: WorkspaceContext, id: string): Promise<MarkNotificationReadResponse> {
    const marked = await this.repository.markRead(workspaceContext.workspaceId, authUser.id, id);
    if (!marked) throw new ResourceNotFoundException(); // safe no-leak — a foreign/nonexistent/already-read id looks identical
    return { id, readAt: new Date().toISOString() };
  }

  async markAllRead(authUser: VerifiedSupabaseToken, workspaceContext: WorkspaceContext): Promise<MarkAllNotificationsReadResponse> {
    const markedCount = await this.repository.markAllRead(workspaceContext.workspaceId, authUser.id);
    return { markedCount };
  }

  private toDto(row: { id: string; type: string; title: string; body: string; entityType: string | null; entityId: string | null; readAt: Date | null; createdAt: Date }): NotificationDto {
    return {
      id: row.id,
      type: row.type as NotificationDto["type"],
      title: row.title,
      body: row.body,
      entityType: row.entityType,
      entityId: row.entityId,
      readAt: row.readAt ? row.readAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
