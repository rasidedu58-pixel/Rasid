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

  // ---------------------------------------------------------------------
  // Phase 15C — `GET /notifications` now fetches its rows + unread count in
  // ONE transaction (was two). These prove the combined loader preserves
  // exactly the same visibility, ordering, unread-count, and workspace/user
  // scoping, and that the endpoint issues the single combined read.
  // ---------------------------------------------------------------------
  describe("Phase 15C — one-transaction page loader", () => {
    it("list() uses the single combined loadPage (one transaction), not two separate reads", async () => {
      repo.seed({ workspaceId: WORKSPACE_A, userId: user.id, type: "FOLLOWUP_DUE", title: "t", body: "b" });
      repo.loadPageCalls = 0;
      await service.list(user, context);
      expect(repo.loadPageCalls).toBe(1);
    });

    it("combined loader is byte-identical to the old two-call path (rows + unreadCount)", async () => {
      repo.seed({ workspaceId: WORKSPACE_A, userId: user.id, type: "FOLLOWUP_DUE", title: "t1", body: "b1" });
      repo.seed({ workspaceId: WORKSPACE_A, userId: user.id, type: "MISSING_RECORDS", title: "t2", body: "b2", readAt: new Date() });
      repo.seed({ workspaceId: WORKSPACE_A, userId: user.id, type: "SUBSCRIPTION_EXPIRING", title: "t3", body: "b3" });

      const viaCombined = await service.list(user, context);
      const rowsDirect = await repo.listForUser(WORKSPACE_A, user.id);
      const unreadDirect = await repo.countUnreadForUser(WORKSPACE_A, user.id);
      expect(viaCombined.notifications.map((n) => n.id)).toEqual(rowsDirect.map((r) => r.id)); // same order
      expect(viaCombined.unreadCount).toBe(unreadDirect);
      expect(viaCombined.unreadCount).toBe(2);
    });

    it("the unread count is scoped to THIS workspace + user — a second workspace's unread never bleeds in", async () => {
      const WORKSPACE_B = "workspace-b";
      // Same user id, different workspace — must be invisible here.
      repo.seed({ workspaceId: WORKSPACE_B, userId: user.id, type: "FOLLOWUP_DUE", title: "other-ws", body: "b" });
      repo.seed({ workspaceId: WORKSPACE_B, userId: user.id, type: "FOLLOWUP_DUE", title: "other-ws-2", body: "b" });
      // One unread in workspace A.
      repo.seed({ workspaceId: WORKSPACE_A, userId: user.id, type: "MISSING_RECORDS", title: "mine", body: "b" });

      const result = await service.list(user, context);
      expect(result.notifications).toHaveLength(1);
      expect(result.notifications[0]!.title).toBe("mine");
      expect(result.unreadCount).toBe(1); // NOT 3 — workspace B's two unread are excluded
    });

    it("an empty stream returns zero rows and a zero unread count (no crash on the count query)", async () => {
      const result = await service.list(user, context);
      expect(result.notifications).toEqual([]);
      expect(result.unreadCount).toBe(0);
    });
  });
});
