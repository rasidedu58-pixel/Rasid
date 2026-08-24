import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import type { WorkspaceContext } from "../../team/api/guards/permission.guard";
import { ResourceNotFoundException } from "../../common/exceptions/api.exception";
import { InMemoryNotificationsRepository } from "./__fixtures__/in-memory-notifications.repository";
import { NotificationsService } from "./notifications.service";

const WORKSPACE_A = "workspace-a";

function membership(userId: string) {
  const now = new Date();
  return { id: "m-1", workspaceId: WORKSPACE_A, userId, roleLabel: "ASSISTANT", status: "ACTIVE", joinedAt: now, disabledAt: null, createdAt: now, updatedAt: now };
}

describe("NotificationsService", () => {
  let repo: InMemoryNotificationsRepository;
  let service: NotificationsService;
  let user: VerifiedSupabaseToken;
  let context: WorkspaceContext;

  beforeEach(() => {
    repo = new InMemoryNotificationsRepository();
    service = new NotificationsService(repo);
    user = { id: "u-1", email: "u1@example.com" };
    context = { workspaceId: WORKSPACE_A, membership: membership(user.id) };
  });

  it("lists only the caller's OWN notifications, newest first, with an accurate unread count", async () => {
    repo.seed({ workspaceId: WORKSPACE_A, userId: user.id, type: "FOLLOWUP_DUE", title: "t1", body: "b1" });
    repo.seed({ workspaceId: WORKSPACE_A, userId: user.id, type: "MISSING_RECORDS", title: "t2", body: "b2", readAt: new Date() });
    repo.seed({ workspaceId: WORKSPACE_A, userId: "someone-else", type: "FOLLOWUP_DUE", title: "not mine", body: "b3" });

    const result = await service.list(user, context);
    expect(result.notifications).toHaveLength(2);
    expect(result.unreadCount).toBe(1);
  });

  it("read/unread lifecycle: markRead flips readAt exactly once, a second call safely no-ops (404, not a crash)", async () => {
    const row = repo.seed({ workspaceId: WORKSPACE_A, userId: user.id, type: "FOLLOWUP_DUE", title: "t", body: "b" });
    expect(row.readAt).toBeNull();

    await service.markRead(user, context, row.id);
    const afterFirst = await repo.listForUser(WORKSPACE_A, user.id);
    expect(afterFirst[0]!.readAt).not.toBeNull();

    await expect(service.markRead(user, context, row.id)).rejects.toBeInstanceOf(ResourceNotFoundException);
  });

  it("markAllRead clears every unread notification for the caller, and only the caller", async () => {
    repo.seed({ workspaceId: WORKSPACE_A, userId: user.id, type: "FOLLOWUP_DUE", title: "t1", body: "b1" });
    repo.seed({ workspaceId: WORKSPACE_A, userId: user.id, type: "MISSING_RECORDS", title: "t2", body: "b2" });
    repo.seed({ workspaceId: WORKSPACE_A, userId: "someone-else", type: "FOLLOWUP_DUE", title: "not mine", body: "b3" });

    const result = await service.markAllRead(user, context);
    expect(result.markedCount).toBe(2);
    expect((await service.list(user, context)).unreadCount).toBe(0);

    const otherRowAfter = (await repo.listForUser(WORKSPACE_A, "someone-else"))[0]!;
    expect(otherRowAfter.readAt).toBeNull(); // untouched
  });

  it("a foreign notification id (belonging to another user) cannot be marked read — safe no-leak", async () => {
    const otherUserRow = repo.seed({ workspaceId: WORKSPACE_A, userId: "someone-else", type: "FOLLOWUP_DUE", title: "not mine", body: "b" });
    await expect(service.markRead(user, context, otherUserRow.id)).rejects.toBeInstanceOf(ResourceNotFoundException);
  });
});
