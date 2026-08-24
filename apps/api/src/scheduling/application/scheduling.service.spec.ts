import { randomUUID } from "node:crypto";
import {
  IdempotencyConflictException,
  MonthAlreadyExistsException,
  ResourceNotFoundException,
  SessionInvalidStateException,
  VersionConflictException,
} from "../../common/exceptions/api.exception";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import type { WorkspaceContext } from "../../team/api/guards/permission.guard";
import { PermissionResolverService } from "../../team/application/permission-resolver.service";
import { InMemoryTeamRepository } from "../../team/application/__fixtures__/in-memory-team.repository";
import { InMemorySchedulingRepository } from "./__fixtures__/in-memory-scheduling.repository";
import { PreviewTokenService } from "./preview-token.service";
import { SchedulingService } from "./scheduling.service";

const WORKSPACE_A = "workspace-a";
const WORKSPACE_B = "workspace-b";

describe("SchedulingService", () => {
  let repo: InMemorySchedulingRepository;
  let teamRepo: InMemoryTeamRepository;
  let resolver: PermissionResolverService;
  let previewTokens: PreviewTokenService;
  let service: SchedulingService;

  let owner: VerifiedSupabaseToken;
  let ownerContext: WorkspaceContext;

  beforeEach(() => {
    repo = new InMemorySchedulingRepository();
    teamRepo = new InMemoryTeamRepository();
    resolver = new PermissionResolverService(teamRepo);
    previewTokens = new PreviewTokenService();
    service = new SchedulingService(repo, resolver, previewTokens);

    owner = { id: "u-owner", email: "owner@example.com" };
    const ownerMembership = teamRepo.seedMembership({ workspaceId: WORKSPACE_A, userId: owner.id, roleLabel: "OWNER" });
    ownerContext = { workspaceId: WORKSPACE_A, membership: ownerMembership };
  });

  function seedActiveGroup(workspaceId = WORKSPACE_A) {
    return repo.seedGroup({ workspaceId, name: "Group " + randomUUID().slice(0, 4) });
  }

  async function createMonthEndToEnd(groupIds: string[], idempotencyKey = randomUUID()) {
    const preview = await service.previewCreateMonth(ownerContext, {
      targetYear: 2026,
      targetMonth: 8,
      selectedGroupIds: groupIds,
      groupInitialConfig: Object.fromEntries(
        groupIds.map((id) => [
          id,
          {
            baseFeeMinor: 20000,
            currencyCode: "EGP",
            duePolicy: "PER_GROUP" as const,
            joinFeePolicy: "FULL" as const,
            scheduleRules: [{ weekday: 5, startTime: "10:00", durationMinutes: 60 }],
          },
        ]),
      ),
    });
    const confirmed = await service.confirmCreateMonth(owner, ownerContext, idempotencyKey, { previewToken: preview.previewToken }, null);
    return { preview, confirmed };
  }

  describe("CreateMonth", () => {
    it("is idempotent: same key + same payload twice returns the same result with no duplicate side effects", async () => {
      const group = seedActiveGroup();
      const key = randomUUID();
      const first = await createMonthEndToEnd([group.id], key);

      // A second confirm call with the SAME key must re-derive the SAME
      // request hash — reissue a preview token (tokens are one-time) but
      // reuse the idempotency key with an identical body shape.
      const preview2 = await service.previewCreateMonth(ownerContext, {
        targetYear: 2026,
        targetMonth: 9,
        selectedGroupIds: [group.id],
        groupInitialConfig: { [group.id]: { baseFeeMinor: 1, currencyCode: "EGP", duePolicy: "PER_GROUP", joinFeePolicy: "FULL", scheduleRules: [] } },
      });
      // Reuse the ORIGINAL preview token's underlying body shape by calling
      // confirm again with the exact same body object as the first call.
      const second = await service.confirmCreateMonth(
        owner,
        ownerContext,
        key,
        { previewToken: first.preview.previewToken },
        null,
      );
      void preview2;

      expect(second).toEqual(first.confirmed);
      const months = await repo.listOperatingMonths(WORKSPACE_A);
      expect(months).toHaveLength(1);
    });

    it("same key with a different payload returns IDEMPOTENCY_CONFLICT", async () => {
      const group = seedActiveGroup();
      const key = randomUUID();
      await createMonthEndToEnd([group.id], key);

      const anotherGroup = seedActiveGroup();
      const preview = await service.previewCreateMonth(ownerContext, {
        targetYear: 2027,
        targetMonth: 1,
        selectedGroupIds: [anotherGroup.id],
        groupInitialConfig: {
          [anotherGroup.id]: { baseFeeMinor: 999, currencyCode: "EGP", duePolicy: "PER_GROUP", joinFeePolicy: "FULL", scheduleRules: [] },
        },
      });

      await expect(
        service.confirmCreateMonth(owner, ownerContext, key, { previewToken: preview.previewToken }, null),
      ).rejects.toBeInstanceOf(IdempotencyConflictException);
    });

    it("rejects creating a duplicate (workspace, year, month) with MONTH_ALREADY_EXISTS", async () => {
      const group = seedActiveGroup();
      await createMonthEndToEnd([group.id]);

      await expect(
        service.previewCreateMonth(ownerContext, { targetYear: 2026, targetMonth: 8, selectedGroupIds: [group.id] }),
      ).rejects.toBeInstanceOf(MonthAlreadyExistsException);
    });

    it("only the Owner can preview/confirm a month (non-owner gets a safe no-leak 404)", async () => {
      const assistant = teamRepo.seedMembership({ workspaceId: WORKSPACE_A, userId: "u-assistant", roleLabel: "ASSISTANT" });
      const assistantContext: WorkspaceContext = { workspaceId: WORKSPACE_A, membership: assistant };
      const group = seedActiveGroup();

      await expect(
        service.previewCreateMonth(assistantContext, { targetYear: 2026, targetMonth: 8, selectedGroupIds: [group.id] }),
      ).rejects.toBeInstanceOf(ResourceNotFoundException);
    });

    it("generates SCHEDULED, billable-for-proration sessions from the group's schedule rules", async () => {
      const group = seedActiveGroup();
      const { confirmed } = await createMonthEndToEnd([group.id]);
      expect(confirmed.groupMonthCount).toBe(1);
      expect(confirmed.sessionCount).toBeGreaterThan(0);

      const sessions = await repo.listSessions({ workspaceId: WORKSPACE_A, limit: 100 });
      expect(sessions.every((s) => s.status === "SCHEDULED" && s.origin === "GENERATED" && s.billableForProration)).toBe(
        true,
      );
    });

    it("keeps INT-01 (single CURRENT month per workspace): creating a second month archives the first", async () => {
      const group = seedActiveGroup();
      const first = await createMonthEndToEnd([group.id]);

      const preview2 = await service.previewCreateMonth(ownerContext, {
        targetYear: 2026,
        targetMonth: 9,
        selectedGroupIds: [group.id],
        groupInitialConfig: {
          [group.id]: { baseFeeMinor: 20000, currencyCode: "EGP", duePolicy: "PER_GROUP", joinFeePolicy: "FULL", scheduleRules: [] },
        },
      });
      await service.confirmCreateMonth(owner, ownerContext, randomUUID(), { previewToken: preview2.previewToken }, null);

      const months = await repo.listOperatingMonths(WORKSPACE_A);
      const current = months.filter((m) => m.status === "CURRENT");
      expect(current).toHaveLength(1);
      const firstMonth = months.find((m) => m.id === first.confirmed.monthId);
      expect(firstMonth?.status).toBe("ARCHIVED");
    });
  });

  describe("listGroupMonthsForMonth (Phase 11 Closure Delta)", () => {
    it("resolves the GroupMonth ids for every group carried into a new month", async () => {
      const groupA = seedActiveGroup();
      const groupB = seedActiveGroup();
      const { confirmed } = await createMonthEndToEnd([groupA.id, groupB.id]);

      const { groupMonths } = await service.listGroupMonthsForMonth(owner, ownerContext, confirmed.monthId);

      expect(groupMonths).toHaveLength(2);
      expect(new Set(groupMonths.map((gm) => gm.groupId))).toEqual(new Set([groupA.id, groupB.id]));
      expect(groupMonths.every((gm) => gm.operatingMonthId === confirmed.monthId)).toBe(true);
    });

    it("filters to only the caller's in-scope groups for a SELECTED_GROUPS grant (same rule as listGroups)", async () => {
      const inScopeGroup = seedActiveGroup();
      const outOfScopeGroup = seedActiveGroup();
      const { confirmed } = await createMonthEndToEnd([inScopeGroup.id, outOfScopeGroup.id]);

      const assistant = teamRepo.seedMembership({ workspaceId: WORKSPACE_A, userId: "u-assistant-gm", roleLabel: "ASSISTANT" });
      const assistantContext: WorkspaceContext = { workspaceId: WORKSPACE_A, membership: assistant };
      await teamRepo.replaceMembershipGrants({
        workspaceId: WORKSPACE_A,
        membershipId: assistant.id,
        createdByUserId: owner.id,
        desiredGrants: [{ permissionKey: "groups.view", scopeType: "SELECTED_GROUPS", groupIds: [inScopeGroup.id] }],
      });
      const assistantUser: VerifiedSupabaseToken = { id: "u-assistant-gm", email: null };

      const { groupMonths } = await service.listGroupMonthsForMonth(assistantUser, assistantContext, confirmed.monthId);

      expect(groupMonths).toHaveLength(1);
      expect(groupMonths[0]?.groupId).toBe(inScopeGroup.id);
    });
  });

  describe("Session cancel", () => {
    it("cancels a SCHEDULED session (status transition only, row never deleted)", async () => {
      const group = seedActiveGroup();
      const { confirmed } = await createMonthEndToEnd([group.id]);
      const sessions = await repo.listSessions({ workspaceId: WORKSPACE_A, limit: 10 });
      const target = sessions[0]!;
      void confirmed;

      const result = await service.cancelSession(owner, ownerContext, target.id, null);
      expect(result.session.status).toBe("CANCELLED");

      const stillThere = await repo.findSessionById(target.id);
      expect(stillThere).toBeDefined();
      expect(stillThere?.status).toBe("CANCELLED");
    });

    it("rejects cancelling a session that is not SCHEDULED with SESSION_INVALID_STATE", async () => {
      const group = seedActiveGroup();
      const { confirmed } = await createMonthEndToEnd([group.id]);
      const sessions = await repo.listSessions({ workspaceId: WORKSPACE_A, limit: 10 });
      const target = sessions[0]!;
      void confirmed;
      await service.cancelSession(owner, ownerContext, target.id, null);

      await expect(service.cancelSession(owner, ownerContext, target.id, null)).rejects.toBeInstanceOf(
        SessionInvalidStateException,
      );
    });
  });

  describe("Session reschedule", () => {
    it("preserves the original (status=RESCHEDULED, never deleted) and creates exactly one replacement", async () => {
      const group = seedActiveGroup();
      await createMonthEndToEnd([group.id]);
      const sessions = await repo.listSessions({ workspaceId: WORKSPACE_A, limit: 10 });
      const target = sessions[0]!;

      const preview = await service.reschedulePreviewSession(owner, ownerContext, target.id, {
        scheduledAt: new Date(target.scheduledAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        durationMinutes: 90,
      });
      const result = await service.rescheduleSession(owner, ownerContext, target.id, { previewToken: preview.previewToken }, null);

      expect(result.original.status).toBe("RESCHEDULED");
      expect(result.original.id).toBe(target.id);
      expect(result.replacement.status).toBe("SCHEDULED");
      expect(result.replacement.origin).toBe("RESCHEDULE_REPLACEMENT");
      expect(result.replacement.billableForProration).toBe(true);

      const originalStillThere = await repo.findSessionById(target.id);
      expect(originalStillThere).toBeDefined();

      const replacements = [...repo.sessionsById.values()].filter((s) => s.rescheduledFromSessionId === target.id);
      expect(replacements).toHaveLength(1);
    });

    it("rejects a second reschedule attempt on the same original", async () => {
      const group = seedActiveGroup();
      await createMonthEndToEnd([group.id]);
      const sessions = await repo.listSessions({ workspaceId: WORKSPACE_A, limit: 10 });
      const target = sessions[0]!;

      const preview1 = await service.reschedulePreviewSession(owner, ownerContext, target.id, {
        scheduledAt: new Date(target.scheduledAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        durationMinutes: 60,
      });
      await service.rescheduleSession(owner, ownerContext, target.id, { previewToken: preview1.previewToken }, null);

      // The original is now RESCHEDULED, not SCHEDULED, so even generating
      // a fresh preview for it must be rejected up front.
      await expect(
        service.reschedulePreviewSession(owner, ownerContext, target.id, {
          scheduledAt: new Date().toISOString(),
          durationMinutes: 60,
        }),
      ).rejects.toBeInstanceOf(SessionInvalidStateException);
    });
  });

  describe("Cross-workspace isolation", () => {
    it("reading a Group belonging to a different workspace is rejected (404 safe-no-leak)", async () => {
      const foreignGroup = seedActiveGroup(WORKSPACE_B);
      await expect(service.getGroup(owner, ownerContext, foreignGroup.id)).rejects.toBeInstanceOf(
        ResourceNotFoundException,
      );
    });

    it("reading a GroupMonth belonging to a different workspace is rejected (404 safe-no-leak)", async () => {
      const foreignGroup = seedActiveGroup(WORKSPACE_B);
      const foreignMonth = repo.seedMonth({ workspaceId: WORKSPACE_B, year: 2026, month: 5, createdByUserId: "u-other" });
      const foreignGroupMonth = repo.seedGroupMonth({
        workspaceId: WORKSPACE_B,
        groupId: foreignGroup.id,
        operatingMonthId: foreignMonth.id,
      });

      await expect(service.getGroupMonth(owner, ownerContext, foreignGroupMonth.id)).rejects.toBeInstanceOf(
        ResourceNotFoundException,
      );
    });
  });

  describe("Permissions / scope enforcement", () => {
    it("a SELECTED_GROUPS assistant without the group in scope gets a safe no-leak 404 on getGroup", async () => {
      const assistant = teamRepo.seedMembership({ workspaceId: WORKSPACE_A, userId: "u-assistant-2", roleLabel: "ASSISTANT" });
      const assistantContext: WorkspaceContext = { workspaceId: WORKSPACE_A, membership: assistant };
      const inScopeGroup = seedActiveGroup();
      const outOfScopeGroup = seedActiveGroup();

      await teamRepo.replaceMembershipGrants({
        workspaceId: WORKSPACE_A,
        membershipId: assistant.id,
        createdByUserId: owner.id,
        desiredGrants: [{ permissionKey: "groups.view", scopeType: "SELECTED_GROUPS", groupIds: [inScopeGroup.id] }],
      });

      const assistantUser: VerifiedSupabaseToken = { id: "u-assistant-2", email: null };
      await expect(service.getGroup(assistantUser, assistantContext, inScopeGroup.id)).resolves.toBeDefined();
      await expect(service.getGroup(assistantUser, assistantContext, outOfScopeGroup.id)).rejects.toBeInstanceOf(
        ResourceNotFoundException,
      );
    });

    it("groups.manage implies groups.view for scope checks (write-implies-read closure)", async () => {
      const assistant = teamRepo.seedMembership({ workspaceId: WORKSPACE_A, userId: "u-assistant-3", roleLabel: "ASSISTANT" });
      const assistantContext: WorkspaceContext = { workspaceId: WORKSPACE_A, membership: assistant };
      const group = seedActiveGroup();

      await teamRepo.replaceMembershipGrants({
        workspaceId: WORKSPACE_A,
        membershipId: assistant.id,
        createdByUserId: owner.id,
        desiredGrants: [{ permissionKey: "groups.manage", scopeType: "SELECTED_GROUPS", groupIds: [group.id] }],
      });

      const assistantUser: VerifiedSupabaseToken = { id: "u-assistant-3", email: null };
      // groups.manage's dependency closure includes groups.view (permission-catalog.ts).
      await expect(service.getGroup(assistantUser, assistantContext, group.id)).resolves.toBeDefined();
    });

    it("sessions.manage implies groups.view for session-detail scope checks (write-implies-read closure)", async () => {
      const assistant = teamRepo.seedMembership({ workspaceId: WORKSPACE_A, userId: "u-assistant-4", roleLabel: "ASSISTANT" });
      const assistantContext: WorkspaceContext = { workspaceId: WORKSPACE_A, membership: assistant };
      const group = seedActiveGroup();
      const { confirmed } = await createMonthEndToEnd([group.id]);
      void confirmed;
      const sessions = await repo.listSessions({ workspaceId: WORKSPACE_A, limit: 10 });
      const target = sessions[0]!;

      await teamRepo.replaceMembershipGrants({
        workspaceId: WORKSPACE_A,
        membershipId: assistant.id,
        createdByUserId: owner.id,
        desiredGrants: [{ permissionKey: "sessions.manage", scopeType: "SELECTED_GROUPS", groupIds: [group.id] }],
      });

      const assistantUser: VerifiedSupabaseToken = { id: "u-assistant-4", email: null };
      // sessions.manage's dependency closure includes groups.view, so
      // getSession (which requires "groups.view" scope) is reachable too.
      await expect(service.getSession(assistantUser, assistantContext, target.id)).resolves.toBeDefined();
      // ...and sessions.manage itself is directly usable for cancel.
      await expect(service.cancelSession(assistantUser, assistantContext, target.id, null)).resolves.toBeDefined();
    });

    it("an assistant with only groups.view (no sessions.manage) cannot cancel a session in scope", async () => {
      const assistant = teamRepo.seedMembership({ workspaceId: WORKSPACE_A, userId: "u-assistant-5", roleLabel: "ASSISTANT" });
      const assistantContext: WorkspaceContext = { workspaceId: WORKSPACE_A, membership: assistant };
      const group = seedActiveGroup();
      await createMonthEndToEnd([group.id]);
      const sessions = await repo.listSessions({ workspaceId: WORKSPACE_A, limit: 10 });
      const target = sessions[0]!;

      await teamRepo.replaceMembershipGrants({
        workspaceId: WORKSPACE_A,
        membershipId: assistant.id,
        createdByUserId: owner.id,
        desiredGrants: [{ permissionKey: "groups.view", scopeType: "SELECTED_GROUPS", groupIds: [group.id] }],
      });

      const assistantUser: VerifiedSupabaseToken = { id: "u-assistant-5", email: null };
      await expect(service.cancelSession(assistantUser, assistantContext, target.id, null)).rejects.toBeInstanceOf(
        ResourceNotFoundException,
      );
    });
  });

  describe("Group version conflict", () => {
    it("returns VERSION_CONFLICT when the supplied version is stale", async () => {
      const group = seedActiveGroup();
      await expect(
        service.updateGroup(owner, ownerContext, group.id, { version: group.version + 1, name: "x" }, null),
      ).rejects.toBeInstanceOf(VersionConflictException);
    });

    it("applies a versioned update when the version matches", async () => {
      const group = seedActiveGroup();
      const updated = await service.updateGroup(owner, ownerContext, group.id, { version: group.version, name: "New Name" }, null);
      expect(updated.name).toBe("New Name");
      expect(updated.version).toBe(group.version + 1);
    });
  });
});
