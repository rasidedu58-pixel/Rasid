import { randomUUID } from "node:crypto";
import {
  IdempotencyConflictException,
  MonthAlreadyExistsException,
  NoCurrentMonthException,
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

  const entitlements = { state: "ALLOWED" as string | undefined, findCurrentEntitlementState: async () => entitlements.state as never };

  beforeEach(() => {
    repo = new InMemorySchedulingRepository();
    repo.monthOverrides = { prepBlocked: false, earlyPrepAllowed: true }; // window logic is covered by the pure eligibility unit test; keep month-prep deterministic here
    teamRepo = new InMemoryTeamRepository();
    resolver = new PermissionResolverService(teamRepo);
    previewTokens = new PreviewTokenService();
    entitlements.state = "ALLOWED";
    service = new SchedulingService(repo, resolver, previewTokens, entitlements);

    owner = { id: "u-owner", email: "owner@example.com" };
    const ownerMembership = teamRepo.seedMembership({ workspaceId: WORKSPACE_A, userId: owner.id, roleLabel: "OWNER" });
    ownerContext = { workspaceId: WORKSPACE_A, membership: ownerMembership };
  });

  // Safety net: any test that pins the system clock (fake timers) restores real
  // time afterwards, so a date-fixed test never leaks its clock into the next.
  afterEach(() => {
    jest.useRealTimers();
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

  describe("prepareGroupForCurrentMonth (Group Wizard foundation)", () => {
    const PREPARE_BODY = {
      locationId: null,
      baseFeeMinor: 20000,
      currencyCode: "EGP",
      duePolicy: "PER_GROUP" as const,
      dueDay: null,
      joinFeePolicy: "FULL" as const,
      scheduleRules: [{ weekday: 5, startTime: "10:00", durationMinutes: 60 }],
    };
    const repoInput = (groupId: string, extra: Partial<Parameters<InMemorySchedulingRepository["prepareGroupForCurrentMonth"]>[0]> = {}) => ({
      workspaceId: WORKSPACE_A,
      groupId,
      createdByUserId: owner.id,
      createdByMembershipId: null,
      workspaceTimezone: "Africa/Cairo",
      now: new Date("2026-08-01T00:00:00.000Z"),
      locationId: null,
      baseFeeMinor: 20000,
      currencyCode: "EGP",
      duePolicy: "PER_GROUP",
      dueDay: null,
      joinFeePolicy: "FULL",
      scheduleRules: [{ weekday: 5, startTime: "10:00", durationMinutes: 60 }],
      ...extra,
    });

    it("throws NO_CURRENT_MONTH when the workspace has no CURRENT operating month (never auto-creates one)", async () => {
      const group = seedActiveGroup();
      await expect(service.prepareGroupForCurrentMonth(owner, ownerContext, group.id, PREPARE_BODY, null)).rejects.toBeInstanceOf(
        NoCurrentMonthException,
      );
    });

    it("returns a no-leak 404 for a group in another workspace (scope enforced in backend)", async () => {
      const groupB = repo.seedGroup({ workspaceId: WORKSPACE_B, name: "Foreign" });
      repo.seedMonth({ workspaceId: WORKSPACE_A, year: 2026, month: 8, createdByUserId: owner.id });
      await expect(service.prepareGroupForCurrentMonth(owner, ownerContext, groupB.id, PREPARE_BODY, null)).rejects.toBeInstanceOf(
        ResourceNotFoundException,
      );
    });

    it("is idempotent: a group already prepared this month returns ALREADY_PREPARED (no duplicate)", async () => {
      const group = seedActiveGroup();
      const month = repo.seedMonth({ workspaceId: WORKSPACE_A, year: 2026, month: 8, createdByUserId: owner.id });
      repo.seedGroupMonth({ workspaceId: WORKSPACE_A, groupId: group.id, operatingMonthId: month.id });
      const res = await service.prepareGroupForCurrentMonth(owner, ownerContext, group.id, PREPARE_BODY, null);
      expect(res.status).toBe("ALREADY_PREPARED");
    });

    it("prepares a new group mid-month: creates the GroupMonth + generates only sessions at/after the prepare date (no past)", async () => {
      const group = seedActiveGroup();
      repo.seedMonth({ workspaceId: WORKSPACE_A, year: 2026, month: 8, createdByUserId: owner.id });
      const now = new Date("2026-08-01T00:00:00.000Z");
      const res = await repo.prepareGroupForCurrentMonth(repoInput(group.id, { now }));
      expect(res.status).toBe("PREPARED");
      if (res.status !== "PREPARED") return;
      expect(res.generatedSessionCount).toBeGreaterThan(0);
      const created = [...repo.sessionsById.values()].filter((s) => s.groupMonthId === res.groupMonth.id);
      expect(created).toHaveLength(res.generatedSessionCount);
      for (const s of created) expect(s.scheduledAt.getTime()).toBeGreaterThanOrEqual(now.getTime());
    });

    it("supports multiple weekly slots (more slots → more generated sessions)", async () => {
      const g1 = seedActiveGroup();
      const g2 = seedActiveGroup();
      repo.seedMonth({ workspaceId: WORKSPACE_A, year: 2026, month: 8, createdByUserId: owner.id });
      const one = await repo.prepareGroupForCurrentMonth(repoInput(g1.id, { scheduleRules: [{ weekday: 5, startTime: "10:00", durationMinutes: 60 }] }));
      const two = await repo.prepareGroupForCurrentMonth(
        repoInput(g2.id, { scheduleRules: [{ weekday: 5, startTime: "10:00", durationMinutes: 60 }, { weekday: 2, startTime: "12:00", durationMinutes: 90 }] }),
      );
      const c1 = one.status === "PREPARED" ? one.generatedSessionCount : -1;
      const c2 = two.status === "PREPARED" ? two.generatedSessionCount : -1;
      expect(c2).toBeGreaterThan(c1);
    });

    it("preparing twice never duplicates sessions (second call is ALREADY_PREPARED with the same count)", async () => {
      const group = seedActiveGroup();
      repo.seedMonth({ workspaceId: WORKSPACE_A, year: 2026, month: 8, createdByUserId: owner.id });
      const first = await repo.prepareGroupForCurrentMonth(repoInput(group.id));
      const second = await repo.prepareGroupForCurrentMonth(repoInput(group.id));
      expect(first.status).toBe("PREPARED");
      expect(second.status).toBe("ALREADY_PREPARED");
      const firstCount = first.status === "PREPARED" ? first.generatedSessionCount : -1;
      const secondCount = second.status === "ALREADY_PREPARED" ? second.generatedSessionCount : -2;
      expect(secondCount).toBe(firstCount);
      const gmId = first.status === "PREPARED" ? first.groupMonth.id : "";
      expect([...repo.sessionsById.values()].filter((s) => s.groupMonthId === gmId)).toHaveLength(firstCount);
    });

    it("generates fewer sessions when prepared later in the month (never in the past)", async () => {
      const g1 = seedActiveGroup();
      const g2 = seedActiveGroup();
      repo.seedMonth({ workspaceId: WORKSPACE_A, year: 2026, month: 8, createdByUserId: owner.id });
      const early = await repo.prepareGroupForCurrentMonth(repoInput(g1.id, { now: new Date("2026-08-01T00:00:00.000Z") }));
      const late = await repo.prepareGroupForCurrentMonth(repoInput(g2.id, { now: new Date("2026-08-28T00:00:00.000Z") }));
      const ec = early.status === "PREPARED" ? early.generatedSessionCount : -1;
      const lc = late.status === "PREPARED" ? late.generatedSessionCount : -1;
      expect(lc).toBeLessThanOrEqual(ec);
    });
  });

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
      // Preparing the immediate next month (Sep) is allowed via an EARLY_PREP override,
      // making this deterministic regardless of the current date.
      repo.monthOverrides = { prepBlocked: false, earlyPrepAllowed: true };
      const preview = await service.previewCreateMonth(ownerContext, {
        targetYear: 2026,
        targetMonth: 9,
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

    it("preparing the next month creates a DRAFT and keeps the current month CURRENT (no archive until activation)", async () => {
      // DRAFT-vs-CURRENT is decided relative to the real "now" (resolvePrepDecision
      // → new Date()): August is the current operating month and September is the
      // month AHEAD (→ DRAFT). Pin the clock to mid-August so this holds regardless
      // of when the suite runs (otherwise, run in September, "September" resolves to
      // CURRENT — the product is correct; only this fixed-month test needs the pin).
      jest.useFakeTimers({ now: new Date("2026-08-15T12:00:00Z"), doNotFake: ["setTimeout", "setInterval", "setImmediate", "clearTimeout", "clearInterval", "clearImmediate", "nextTick", "queueMicrotask", "performance"] });
      const group = seedActiveGroup();
      const first = await createMonthEndToEnd([group.id]); // August → CURRENT (bootstrap)

      // EARLY_PREP override makes preparing September deterministic (any date).
      repo.monthOverrides = { prepBlocked: false, earlyPrepAllowed: true };
      const preview2 = await service.previewCreateMonth(ownerContext, {
        targetYear: 2026,
        targetMonth: 9,
        selectedGroupIds: [group.id],
        groupInitialConfig: {
          [group.id]: { baseFeeMinor: 20000, currencyCode: "EGP", duePolicy: "PER_GROUP", joinFeePolicy: "FULL", scheduleRules: [] },
        },
      });
      const confirmed2 = await service.confirmCreateMonth(owner, ownerContext, randomUUID(), { previewToken: preview2.previewToken }, null);

      expect(confirmed2.status).toBe("DRAFT");
      const months = await repo.listOperatingMonths(WORKSPACE_A);
      expect(months.filter((m) => m.status === "CURRENT")).toHaveLength(1);
      expect(months.find((m) => m.id === first.confirmed.monthId)?.status).toBe("CURRENT"); // NOT archived
      expect(months.find((m) => m.id === confirmed2.monthId)?.status).toBe("DRAFT");
    });

    it("prep eligibility is ENTITLEMENT_REQUIRED when CREATE_MONTH is not available (expired/no subscription)", async () => {
      repo.seedMonth({ workspaceId: WORKSPACE_A, year: 2026, month: 8, createdByUserId: owner.id, status: "CURRENT" });
      entitlements.state = "BLOCKED";
      const elig = await service.getMonthPrepEligibility(ownerContext);
      expect(elig.canPrepare).toBe(false);
      expect(elig.blockedReason).toBe("ENTITLEMENT_REQUIRED");
      expect(elig.wouldBeStatus).toBeNull();
    });

    it("prep eligibility falls through to the normal window/override evaluation when CREATE_MONTH is available", async () => {
      repo.seedMonth({ workspaceId: WORKSPACE_A, year: 2026, month: 8, createdByUserId: owner.id, status: "CURRENT" });
      entitlements.state = "ALLOWED";
      repo.monthOverrides = { prepBlocked: false, earlyPrepAllowed: true };
      const elig = await service.getMonthPrepEligibility(ownerContext);
      expect(elig.canPrepare).toBe(true);
      expect(elig.blockedReason).toBeNull();
      expect(elig.wouldBeStatus).not.toBeNull();
    });

    it("activating a DRAFT archives the old CURRENT and promotes the DRAFT atomically (single CURRENT preserved)", async () => {
      const aug = repo.seedMonth({ workspaceId: WORKSPACE_A, year: 2026, month: 8, createdByUserId: owner.id, status: "CURRENT" });
      const sep = repo.seedMonth({ workspaceId: WORKSPACE_A, year: 2026, month: 9, createdByUserId: owner.id, status: "DRAFT" });
      const res = await repo.runActivateMonthTransaction({ workspaceId: WORKSPACE_A, monthId: sep.id, actorUserId: owner.id, actorMembershipId: null });
      expect(res.status).toBe("ACTIVATED");
      const months = await repo.listOperatingMonths(WORKSPACE_A);
      expect(months.find((m) => m.id === aug.id)?.status).toBe("ARCHIVED");
      expect(months.find((m) => m.id === sep.id)?.status).toBe("CURRENT");
      expect(months.filter((m) => m.status === "CURRENT")).toHaveLength(1);
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

  // ---- Phase 15C: /groups list reusing the guard-resolved grant ----
  // The guard resolves the route's required permission (groups.view) and
  // stores the grant on WorkspaceContext; listGroups reuses it instead of
  // re-resolving. These prove the reuse path yields IDENTICAL visibility to
  // the fallback and does not re-query membership.
  describe("listGroups grant-reuse (Phase 15C)", () => {
    async function grantFor(userId: string, membership: WorkspaceContext["membership"]) {
      return resolver.hasPermission(WORKSPACE_A, userId, "groups.view", membership);
    }

    it("owner with reused grant sees all groups, no cross-tenant leak, 0 re-query", async () => {
      const gA = seedActiveGroup();
      const gB = seedActiveGroup();
      const foreign = seedActiveGroup(WORKSPACE_B);

      const grant = await grantFor(owner.id, ownerContext.membership);
      const ctxWithGrant: WorkspaceContext = { ...ownerContext, grant };

      teamRepo.findMembershipByUserAndWorkspaceCalls = 0;
      const viaGrant = await service.listGroups(owner, ctxWithGrant);
      const reuseQueries = teamRepo.findMembershipByUserAndWorkspaceCalls;
      const viaFallback = await service.listGroups(owner, ownerContext);

      const idsGrant = viaGrant.groups.map((g) => g.id).sort();
      expect(idsGrant).toEqual(viaFallback.groups.map((g) => g.id).sort()); // identical
      expect(idsGrant).toEqual([gA.id, gB.id].sort());
      expect(idsGrant).not.toContain(foreign.id); // WORKSPACE_B never leaks
      expect(reuseQueries).toBe(0); // reuse avoided the re-query
    });

    it("SELECTED_GROUPS assistant with reused grant sees only in-scope groups (== fallback)", async () => {
      const inScope = seedActiveGroup();
      const outOfScope = seedActiveGroup();
      const assistant = teamRepo.seedMembership({ workspaceId: WORKSPACE_A, userId: "u-assist-lg", roleLabel: "ASSISTANT" });
      const assistantContext: WorkspaceContext = { workspaceId: WORKSPACE_A, membership: assistant };
      await teamRepo.replaceMembershipGrants({
        workspaceId: WORKSPACE_A,
        membershipId: assistant.id,
        createdByUserId: owner.id,
        desiredGrants: [{ permissionKey: "groups.view", scopeType: "SELECTED_GROUPS", groupIds: [inScope.id] }],
      });
      const assistantUser: VerifiedSupabaseToken = { id: "u-assist-lg", email: null };
      const grant = await grantFor(assistantUser.id, assistant);
      const ctxWithGrant: WorkspaceContext = { ...assistantContext, grant };

      const viaGrant = await service.listGroups(assistantUser, ctxWithGrant);
      const viaFallback = await service.listGroups(assistantUser, assistantContext);

      const ids = viaGrant.groups.map((g) => g.id);
      expect(viaGrant.groups.map((g) => g.id).sort()).toEqual(viaFallback.groups.map((g) => g.id).sort());
      expect(ids).toContain(inScope.id);
      expect(ids).not.toContain(outOfScope.id); // scope preserved
    });

    it("a mismatched-permission grant on the context is ignored (falls back safely)", async () => {
      const gA = seedActiveGroup();
      const bogus = { permission: "finance.overview" as const, scope: "ALL_GROUPS" as const };
      const ctx: WorkspaceContext = { ...ownerContext, grant: bogus };

      const results = await service.listGroups(owner, ctx);
      // Falls back to a real resolve → owner still sees their group.
      expect(results.groups.map((g) => g.id)).toContain(gA.id);
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
