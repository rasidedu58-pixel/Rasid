import type { ActionCenterDataParams, CollectionQueueRow } from "@academic-precision/database";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import type { WorkspaceContext } from "../../team/api/guards/permission.guard";
import { PermissionResolverService } from "../../team/application/permission-resolver.service";
import { InMemoryTeamRepository } from "../../team/application/__fixtures__/in-memory-team.repository";
import type { ActionCenterRepositoryPort } from "./ports/action-center-repository.port";
import { ActionCenterService } from "./action-center.service";

const WORKSPACE_A = "workspace-a";
const GROUP_A = "group-a";

describe("ActionCenterService", () => {
  let teamRepo: InMemoryTeamRepository;
  let resolver: PermissionResolverService;

  let attentionCases: Array<{ id: string; status: string; priority: string; groupId: string }>;
  let followups: Array<{ id: string; status: string; dueAt: Date; groupId: string }>;
  let collectionRows: CollectionQueueRow[];
  let subscriptionState: string | null;
  /** Records the params of the last loadActionCenterData call, so a test can assert which sections were requested / their scope. */
  let lastParams: ActionCenterDataParams | undefined;

  let actionCenterRepo: ActionCenterRepositoryPort;
  let service: ActionCenterService;

  let owner: VerifiedSupabaseToken;
  let ownerContext: WorkspaceContext;

  beforeEach(() => {
    teamRepo = new InMemoryTeamRepository();
    resolver = new PermissionResolverService(teamRepo);
    attentionCases = [];
    followups = [];
    collectionRows = [];
    subscriptionState = null;
    lastParams = undefined;

    const inScope = (groupId: string, restrict: string[] | undefined) => restrict === undefined || restrict.includes(groupId);

    // Phase 15C — the single combined loader. Mirrors the real one: it
    // returns each section ONLY when the service requested it (i.e. the
    // caller had permission), filtered by the passed group scope.
    actionCenterRepo = {
      getCurrentMonth: async () => ({ id: "month-1", year: 2026, month: 8 }),
      listSessionsWithMissingRecords: async () => [],
      getNextSession: async () => undefined,
      loadActionCenterData: async (p: ActionCenterDataParams) => {
        lastParams = p;
        return {
          month: { id: "month-1", year: 2026, month: 8 },
          attentionCases: p.attention
            ? (attentionCases
                .filter((c) => inScope(c.groupId, p.attention!.restrictToGroupIds))
                .map((c) => ({
                  case: { id: c.id, status: c.status, priority: c.priority, workspaceId: WORKSPACE_A, studentId: "s", openedAt: new Date(), lastQualifiedAt: new Date(), contactedAt: null, monitoringSince: null, closedAt: null, createdAt: new Date(), updatedAt: new Date(), version: 1 },
                  studentName: "أحمد محمد",
                  primaryRuleKey: "ATTENDANCE_ABSENCE_STREAK",
                })) as never)
            : undefined,
          followups: p.followups
            ? (followups
                .filter((f) => inScope(f.groupId, p.followups!.restrictToGroupIds))
                .map((f) => ({
                  followup: { id: f.id, status: f.status, dueAt: f.dueAt, workspaceId: WORKSPACE_A, attentionCaseId: "c", studentId: "s", assigneeMembershipId: null, sourceContactLogId: null, completedAt: null, createdAt: new Date(), updatedAt: new Date(), version: 1 },
                  studentName: "أحمد محمد",
                })) as never)
            : undefined,
          missingRecords: p.missing ? [] : undefined,
          collection: p.collection ? collectionRows.filter((r) => inScope(r.groupId, p.collection!.restrictToGroupIds)) : undefined,
          subscription:
            p.subscription && subscriptionState
              ? ({ id: "sub-1", workspaceId: WORKSPACE_A, provider: "PADDLE", providerCustomerId: null, providerSubscriptionId: null, state: subscriptionState, periodStart: new Date(), periodEnd: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), cancelAtPeriodEnd: false, createdAt: new Date(), updatedAt: new Date(), version: 1 } as never)
              : undefined,
          nextSession: undefined,
        };
      },
    } as unknown as ActionCenterRepositoryPort;

    service = new ActionCenterService(resolver, actionCenterRepo);

    owner = { id: "u-owner", email: "owner@example.com" };
    const ownerMembership = teamRepo.seedMembership({ workspaceId: WORKSPACE_A, userId: owner.id, roleLabel: "OWNER" });
    ownerContext = { workspaceId: WORKSPACE_A, membership: ownerMembership };
  });

  it("Closure correction #5: an Assistant with follow-up access but NO finance access sees Attention/Follow-ups, and Collection is OMITTED entirely (not a zeroed count)", async () => {
    attentionCases.push({ id: "case-1", status: "NEW", priority: "HIGH", groupId: GROUP_A });
    followups.push({ id: "f-1", status: "PENDING", dueAt: new Date(Date.now() - 60_000), groupId: GROUP_A });
    collectionRows.push({
      obligation: { id: "ob-1", remainingMinor: 5000, status: "UNPAID" } as never,
      studentId: "s-1",
      studentName: "طالب",
      studentCode: "AP-1",
      groupMonthId: "gm-1",
      groupId: GROUP_A,
    });

    const assistant: VerifiedSupabaseToken = { id: "u-assistant", email: "a@example.com" };
    const assistantMembership = teamRepo.seedMembership({ workspaceId: WORKSPACE_A, userId: assistant.id, roleLabel: "ASSISTANT" });
    await teamRepo.replaceMembershipGrants({
      workspaceId: WORKSPACE_A,
      membershipId: assistantMembership.id,
      createdByUserId: owner.id,
      desiredGrants: [{ permissionKey: "followup.read", scopeType: "SELECTED_GROUPS", groupIds: [GROUP_A] }],
    });
    const assistantContext: WorkspaceContext = { workspaceId: WORKSPACE_A, membership: assistantMembership };

    const result = await service.getActionCenter(assistant, assistantContext);
    expect(result.attention?.count).toBe(1);
    expect(result.followUpsDue?.count).toBe(1);
    expect(result.collection).toBeUndefined(); // OMITTED, not { count: 0, items: [] }
    expect("collection" in result ? result.collection : "absent").not.toEqual({ count: 0, items: [] });
  });

  it("a caller WITH finance access (but no follow-up access) sees Collection, and Attention/FollowUps are omitted", async () => {
    collectionRows.push({
      obligation: { id: "ob-1", remainingMinor: 5000, status: "UNPAID" } as never,
      studentId: "s-1",
      studentName: "طالب",
      studentCode: "AP-1",
      groupMonthId: "gm-1",
      groupId: GROUP_A,
    });
    const assistant: VerifiedSupabaseToken = { id: "u-finance", email: "f@example.com" };
    const assistantMembership = teamRepo.seedMembership({ workspaceId: WORKSPACE_A, userId: assistant.id, roleLabel: "ASSISTANT" });
    await teamRepo.replaceMembershipGrants({
      workspaceId: WORKSPACE_A,
      membershipId: assistantMembership.id,
      createdByUserId: owner.id,
      desiredGrants: [{ permissionKey: "payments.view_student_status", scopeType: "SELECTED_GROUPS", groupIds: [GROUP_A] }],
    });
    const assistantContext: WorkspaceContext = { workspaceId: WORKSPACE_A, membership: assistantMembership };

    const result = await service.getActionCenter(assistant, assistantContext);
    expect(result.collection?.count).toBe(1);
    expect(result.attention).toBeUndefined();
    expect(result.followUpsDue).toBeUndefined();
  });

  it("a CLOSED attention case never appears in the actionable list", async () => {
    attentionCases.push({ id: "case-closed", status: "CLOSED", priority: "MEDIUM", groupId: GROUP_A });
    attentionCases.push({ id: "case-open", status: "IN_FOLLOWUP", priority: "MEDIUM", groupId: GROUP_A });

    const result = await service.getActionCenter(owner, ownerContext);
    expect(result.attention?.count).toBe(1);
    expect(result.attention?.items.map((i) => i.entityId)).toEqual(["case-open"]);
  });

  it("attention items name WHO and WHY (student + concrete reason), and collection shows amounts in ج.م — never قرش or raw minor units", async () => {
    attentionCases.push({ id: "case-1", status: "NEW", priority: "HIGH", groupId: GROUP_A });
    collectionRows.push({ obligation: { id: "ob-1", remainingMinor: 30000, status: "UNPAID" } as never, studentId: "s-1", studentName: "مصطفى ماهر", studentCode: "AP-1", groupMonthId: "gm-1", groupId: GROUP_A });

    const result = await service.getActionCenter(owner, ownerContext);
    // Attention: "<student> — <reason>", never a generic "حالة انتباه".
    expect(result.attention?.items[0]?.reason).toBe("أحمد محمد — غياب متكرر");
    expect(result.attention?.items[0]?.reason).not.toContain("حالة انتباه");
    // Collection: amount in EGP (ج.م), 30000 minor → 300, never "قرش".
    const colReason = result.collection?.items[0]?.reason ?? "";
    expect(colReason).toContain("ج.م");
    expect(colReason).toContain("300");
    expect(colReason).not.toContain("قرش");
  });

  it("subscription warning is Owner-only, and only appears for a state that actually warrants one", async () => {
    subscriptionState = "ACTIVE";
    const activeResult = await service.getActionCenter(owner, ownerContext);
    expect(activeResult.subscriptionWarning).toBeUndefined(); // ACTIVE never warns

    subscriptionState = "EXPIRING";
    const expiringResult = await service.getActionCenter(owner, ownerContext);
    expect(expiringResult.subscriptionWarning).toBeDefined();
    expect(expiringResult.subscriptionWarning?.state).toBe("EXPIRING");

    const assistant: VerifiedSupabaseToken = { id: "u-assistant", email: "a@example.com" };
    const assistantMembership = teamRepo.seedMembership({ workspaceId: WORKSPACE_A, userId: assistant.id, roleLabel: "ASSISTANT" });
    const assistantContext: WorkspaceContext = { workspaceId: WORKSPACE_A, membership: assistantMembership };
    const assistantResult = await service.getActionCenter(assistant, assistantContext);
    expect(assistantResult.subscriptionWarning).toBeUndefined(); // never shown to a non-Owner
  });

  // ---- Phase 15C: single-transaction consolidation (security + scope) ----
  describe("consolidation (Phase 15C)", () => {
    it("does NOT request a section the caller lacks permission for (no fetch, no leak)", async () => {
      const assistant: VerifiedSupabaseToken = { id: "u-attn-only", email: "x@example.com" };
      const m = teamRepo.seedMembership({ workspaceId: WORKSPACE_A, userId: assistant.id, roleLabel: "ASSISTANT" });
      await teamRepo.replaceMembershipGrants({
        workspaceId: WORKSPACE_A, membershipId: m.id, createdByUserId: owner.id,
        desiredGrants: [{ permissionKey: "followup.read", scopeType: "SELECTED_GROUPS", groupIds: [GROUP_A] }],
      });
      await service.getActionCenter(assistant, { workspaceId: WORKSPACE_A, membership: m });

      // Attention/follow-ups requested (has followup.read), scoped to GROUP_A;
      // collection/subscription NOT requested at all (no permission → no fetch).
      expect(lastParams?.attention?.restrictToGroupIds).toEqual([GROUP_A]);
      expect(lastParams?.followups?.restrictToGroupIds).toEqual([GROUP_A]);
      expect(lastParams?.collection).toBeUndefined();
      expect(lastParams?.subscription).toBe(false);
      // next-session: PRESERVED original behaviour — a caller with no
      // groups.view grant defaults to "ALL" (this exact default existed
      // before the consolidation; functional equivalence is the requirement,
      // not "fixing" it here).
      expect(lastParams?.nextSession.visibleGroupIds).toBe("ALL");
    });

    it("owner requests every section unrestricted (ALL scope) and reuses the guard membership (0 re-query)", async () => {
      teamRepo.findMembershipByUserAndWorkspaceCalls = 0;
      await service.getActionCenter(owner, ownerContext);

      expect(lastParams?.attention?.restrictToGroupIds).toBeUndefined(); // ALL_GROUPS
      expect(lastParams?.collection?.restrictToGroupIds).toBeUndefined();
      expect(lastParams?.subscription).toBe(true);
      expect(lastParams?.nextSession.visibleGroupIds).toBe("ALL");
      // Membership hint reused (guard already fetched it) → resolver did not re-query.
      expect(teamRepo.findMembershipByUserAndWorkspaceCalls).toBe(0);
    });

    it("scoped assistant's collection scope is the UNION of finance grants, never wider", async () => {
      collectionRows.push({ obligation: { id: "ob-1", remainingMinor: 100, status: "UNPAID" } as never, studentId: "s", studentName: "ط", studentCode: "AP", groupMonthId: "gm", groupId: GROUP_A });
      collectionRows.push({ obligation: { id: "ob-2", remainingMinor: 200, status: "UNPAID" } as never, studentId: "s2", studentName: "ط2", studentCode: "AP2", groupMonthId: "gm2", groupId: "group-b" });
      const assistant: VerifiedSupabaseToken = { id: "u-fin", email: "f@example.com" };
      const m = teamRepo.seedMembership({ workspaceId: WORKSPACE_A, userId: assistant.id, roleLabel: "ASSISTANT" });
      await teamRepo.replaceMembershipGrants({
        workspaceId: WORKSPACE_A, membershipId: m.id, createdByUserId: owner.id,
        desiredGrants: [{ permissionKey: "payments.view_student_status", scopeType: "SELECTED_GROUPS", groupIds: [GROUP_A] }],
      });
      const result = await service.getActionCenter(assistant, { workspaceId: WORKSPACE_A, membership: m });

      expect(lastParams?.collection?.restrictToGroupIds).toEqual([GROUP_A]); // NOT group-b
      // Only GROUP_A's obligation is visible; group-b never leaks.
      expect(result.collection?.items.map((i) => i.entityId)).toEqual(["ob-1"]);
    });
  });
});
