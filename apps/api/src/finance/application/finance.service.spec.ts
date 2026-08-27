import { randomUUID } from "node:crypto";
import {
  ForbiddenApiException,
  IdempotencyConflictException,
  ObligationNotPayableException,
  PaymentAlreadyReversedException,
  PaymentExceedsRemainingException,
  ResourceNotFoundException,
} from "../../common/exceptions/api.exception";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import type { WorkspaceContext } from "../../team/api/guards/permission.guard";
import { PermissionResolverService } from "../../team/application/permission-resolver.service";
import { InMemoryTeamRepository } from "../../team/application/__fixtures__/in-memory-team.repository";
import { PreviewTokenService } from "../../scheduling/application/preview-token.service";
import { InMemoryStudentsRepository } from "../../students/application/__fixtures__/in-memory-students.repository";
import { StudentsService } from "../../students/application/students.service";
import { EnrollmentsService } from "../../students/application/enrollments.service";
import { InMemoryFinanceRepository } from "./__fixtures__/in-memory-finance.repository";
import { FinanceService } from "./finance.service";

const WORKSPACE_A = "workspace-a";

describe("FinanceService", () => {
  let shared: InMemoryStudentsRepository;
  let repo: InMemoryFinanceRepository;
  let teamRepo: InMemoryTeamRepository;
  let resolver: PermissionResolverService;
  let studentsService: StudentsService;
  let enrollmentsService: EnrollmentsService;
  let service: FinanceService;

  let owner: VerifiedSupabaseToken;
  let ownerContext: WorkspaceContext;
  let groupA: ReturnType<InMemoryStudentsRepository["seedGroup"]>;
  let groupMonthA: ReturnType<InMemoryStudentsRepository["seedGroupMonth"]>;

  beforeEach(() => {
    shared = new InMemoryStudentsRepository();
    repo = new InMemoryFinanceRepository(shared);
    teamRepo = new InMemoryTeamRepository();
    resolver = new PermissionResolverService(teamRepo);
    studentsService = new StudentsService(shared, resolver);
    enrollmentsService = new EnrollmentsService(shared, resolver, new PreviewTokenService());
    service = new FinanceService(repo, resolver);

    owner = { id: "u-owner", email: "owner@example.com" };
    const ownerMembership = teamRepo.seedMembership({ workspaceId: WORKSPACE_A, userId: owner.id, roleLabel: "OWNER" });
    ownerContext = { workspaceId: WORKSPACE_A, membership: ownerMembership };

    groupA = shared.seedGroup({ workspaceId: WORKSPACE_A, name: "Group A" });
    groupMonthA = shared.seedGroupMonth({ workspaceId: WORKSPACE_A, groupId: groupA.id, joinFeePolicy: "FULL", baseFeeMinor: 60000 });
  });

  async function seedEnrolledStudent(name = "طالب") {
    const created = await studentsService.createStudent(owner, ownerContext, { name }, null);
    const preview = await enrollmentsService.previewEnrollment(owner, ownerContext, groupMonthA.id, {
      studentId: created.student.id,
      joinDate: "2026-08-01",
    });
    const enrolled = await enrollmentsService.createEnrollment(
      owner,
      ownerContext,
      groupMonthA.id,
      { studentId: created.student.id, joinDate: "2026-08-01", feeMethod: "FULL_MONTH", previewToken: preview.previewToken },
      null,
    );
    return { student: created.student, enrollment: enrolled.enrollment, obligation: enrolled.obligation };
  }

  describe("obligation amounts match Enrollment/proration (mandatory)", () => {
    it("FULL_MONTH obligation matches the GroupMonth's base fee exactly", async () => {
      const { obligation } = await seedEnrolledStudent();
      expect(obligation.netDueMinor).toBe(60000);
      expect(obligation.remainingMinor).toBe(60000);
      expect(obligation.status).toBe("UNPAID");
    });

    it("REMAINING_SESSIONS obligation matches the approved proration formula, and CANCELLED sessions never inflate/deflate it incorrectly", async () => {
      const gm = shared.seedGroupMonth({ workspaceId: WORKSPACE_A, groupId: groupA.id, joinFeePolicy: "ASK_EVERY_TIME", baseFeeMinor: 60000 });
      for (let i = 0; i < 5; i += 1) {
        shared.seedSession({ workspaceId: WORKSPACE_A, groupMonthId: gm.id, createdByUserId: owner.id, scheduledAt: new Date(Date.UTC(2026, 7, 1 + i, 8, 0, 0)) });
      }
      // 3 more BEFORE the cancelled one — cancelled sessions must be excluded from totalBillableSessions.
      for (let i = 0; i < 3; i += 1) {
        shared.seedSession({ workspaceId: WORKSPACE_A, groupMonthId: gm.id, createdByUserId: owner.id, scheduledAt: new Date(Date.UTC(2026, 7, 15 + i, 8, 0, 0)) });
      }
      shared.seedSession({
        workspaceId: WORKSPACE_A,
        groupMonthId: gm.id,
        createdByUserId: owner.id,
        scheduledAt: new Date(Date.UTC(2026, 7, 20, 8, 0, 0)),
        status: "CANCELLED",
      });

      const created = await studentsService.createStudent(owner, ownerContext, { name: "طالب" }, null);
      const preview = await enrollmentsService.previewEnrollment(owner, ownerContext, gm.id, {
        studentId: created.student.id,
        joinDate: "2026-08-15",
        feeMethod: "REMAINING_SESSIONS",
      });
      // Same exact PRD AC-07 worked example (60000 * 3 / 8) — the cancelled session contributes nothing.
      expect(preview.calculatedDueMinor).toBe(22500);

      const enrolled = await enrollmentsService.createEnrollment(
        owner,
        ownerContext,
        gm.id,
        { studentId: created.student.id, joinDate: "2026-08-15", feeMethod: "REMAINING_SESSIONS", previewToken: preview.previewToken },
        null,
      );
      expect(enrolled.obligation.netDueMinor).toBe(22500);
      expect(enrolled.obligation.calculationBasis).toBe("REMAINING_SESSIONS");
    });
  });

  describe("RecordPayment", () => {
    it("a valid partial payment updates the obligation correctly", async () => {
      const { obligation } = await seedEnrolledStudent();
      const result = await service.recordPayment(owner, ownerContext, "key-partial", { obligationId: obligation.id, amountMinor: 20000, method: "CASH" }, null);
      expect(result.payment.amountMinor).toBe(20000);
      expect(result.obligation.amountPaidMinor).toBe(20000);
      expect(result.obligation.remainingMinor).toBe(40000);
      expect(result.obligation.status).toBe("PARTIAL");
    });

    it("a valid full payment marks the obligation PAID", async () => {
      const { obligation } = await seedEnrolledStudent();
      const result = await service.recordPayment(owner, ownerContext, "key-full", { obligationId: obligation.id, amountMinor: 60000, method: "TRANSFER" }, null);
      expect(result.obligation.amountPaidMinor).toBe(60000);
      expect(result.obligation.remainingMinor).toBe(0);
      expect(result.obligation.status).toBe("PAID");
    });

    it("overpayment (amount > remaining) is rejected — no credit balance in V1", async () => {
      const { obligation } = await seedEnrolledStudent();
      await expect(
        service.recordPayment(owner, ownerContext, "key-over", { obligationId: obligation.id, amountMinor: 70000, method: "CASH" }, null),
      ).rejects.toBeInstanceOf(PaymentExceedsRemainingException);
      const reloaded = await repo.findObligationById(obligation.id);
      expect(reloaded!.status).toBe("UNPAID"); // no side effect at all
    });

    it("recording against an already-PAID obligation is rejected", async () => {
      const { obligation } = await seedEnrolledStudent();
      await service.recordPayment(owner, ownerContext, "key-1", { obligationId: obligation.id, amountMinor: 60000, method: "CASH" }, null);
      await expect(
        service.recordPayment(owner, ownerContext, "key-2", { obligationId: obligation.id, amountMinor: 1, method: "CASH" }, null),
      ).rejects.toBeInstanceOf(ObligationNotPayableException);
    });

    it("duplicate Idempotency-Key + SAME payload never creates a second payment", async () => {
      const { obligation } = await seedEnrolledStudent();
      const body = { obligationId: obligation.id, amountMinor: 20000, method: "CASH" as const };
      const first = await service.recordPayment(owner, ownerContext, "dup-key", body, null);
      const second = await service.recordPayment(owner, ownerContext, "dup-key", body, null);
      expect(second).toEqual(first);
      expect(repo.paymentsById.size).toBe(1); // exactly one payment ever created
    });

    it("SAME Idempotency-Key + DIFFERENT payload is a 409 conflict", async () => {
      const { obligation } = await seedEnrolledStudent();
      await service.recordPayment(owner, ownerContext, "conflict-key", { obligationId: obligation.id, amountMinor: 20000, method: "CASH" }, null);
      await expect(
        service.recordPayment(owner, ownerContext, "conflict-key", { obligationId: obligation.id, amountMinor: 30000, method: "CASH" }, null),
      ).rejects.toBeInstanceOf(IdempotencyConflictException);
    });
  });

  describe("ReversePayment", () => {
    it("reversal restores the obligation's balances correctly", async () => {
      const { obligation } = await seedEnrolledStudent();
      const recorded = await service.recordPayment(owner, ownerContext, "key-1", { obligationId: obligation.id, amountMinor: 20000, method: "CASH" }, null);
      const reversed = await service.reversePayment(owner, ownerContext, recorded.payment.id, "rev-key", { reason: "خطأ في التسجيل" }, null);

      expect(reversed.payment.status).toBe("REVERSED");
      expect(reversed.obligation.amountPaidMinor).toBe(0);
      expect(reversed.obligation.remainingMinor).toBe(60000);
      expect(reversed.obligation.status).toBe("UNPAID");
    });

    it("payment history is never hidden/deleted after a reversal", async () => {
      const { obligation } = await seedEnrolledStudent();
      const recorded = await service.recordPayment(owner, ownerContext, "key-1", { obligationId: obligation.id, amountMinor: 20000, method: "CASH" }, null);
      await service.reversePayment(owner, ownerContext, recorded.payment.id, "rev-key", { reason: "خطأ" }, null);

      const history = await repo.listPaymentsForObligation(obligation.id);
      expect(history).toHaveLength(1); // the ORIGINAL row, still present — status flipped, never deleted
      expect(history[0]!.id).toBe(recorded.payment.id);
      expect(history[0]!.status).toBe("REVERSED");
    });

    it("reversing the same payment twice is rejected — no duplicate financial effect", async () => {
      const { obligation } = await seedEnrolledStudent();
      const recorded = await service.recordPayment(owner, ownerContext, "key-1", { obligationId: obligation.id, amountMinor: 20000, method: "CASH" }, null);
      await service.reversePayment(owner, ownerContext, recorded.payment.id, "rev-key-1", { reason: "خطأ" }, null);
      await expect(
        service.reversePayment(owner, ownerContext, recorded.payment.id, "rev-key-2", { reason: "خطأ مرة أخرى" }, null),
      ).rejects.toBeInstanceOf(PaymentAlreadyReversedException);
    });
  });

  describe("Cross-tenant / Cross-group isolation", () => {
    it("no cross-workspace payment — an obligation from another workspace 404s (safe no-leak)", async () => {
      const { obligation } = await seedEnrolledStudent();
      const foreignContext: WorkspaceContext = { ...ownerContext, workspaceId: "workspace-b" };
      const foreignMembership = teamRepo.seedMembership({ workspaceId: "workspace-b", userId: owner.id, roleLabel: "OWNER" });
      foreignContext.membership = foreignMembership;
      await expect(
        service.recordPayment(owner, foreignContext, "key-cross", { obligationId: obligation.id, amountMinor: 1000, method: "CASH" }, null),
      ).rejects.toBeInstanceOf(ResourceNotFoundException);
    });

    it("no cross-group leakage — an assistant scoped to Group A cannot record a payment on a Group B obligation", async () => {
      const { obligation: obligationA } = await seedEnrolledStudent("طالب أ");

      const groupB = shared.seedGroup({ workspaceId: WORKSPACE_A, name: "Group B" });
      const groupMonthB = shared.seedGroupMonth({ workspaceId: WORKSPACE_A, groupId: groupB.id, joinFeePolicy: "FULL", baseFeeMinor: 60000 });
      const studentB = await studentsService.createStudent(owner, ownerContext, { name: "طالب ب" }, null);
      const previewB = await enrollmentsService.previewEnrollment(owner, ownerContext, groupMonthB.id, { studentId: studentB.student.id, joinDate: "2026-08-01" });
      const enrolledB = await enrollmentsService.createEnrollment(
        owner,
        ownerContext,
        groupMonthB.id,
        { studentId: studentB.student.id, joinDate: "2026-08-01", feeMethod: "FULL_MONTH", previewToken: previewB.previewToken },
        null,
      );

      const assistantA: VerifiedSupabaseToken = { id: "u-assistant-a", email: "assistant-a@example.com" };
      const assistantMembership = teamRepo.seedMembership({ workspaceId: WORKSPACE_A, userId: assistantA.id, roleLabel: "ASSISTANT" });
      await teamRepo.replaceMembershipGrants({
        workspaceId: WORKSPACE_A,
        membershipId: assistantMembership.id,
        createdByUserId: owner.id,
        desiredGrants: [{ permissionKey: "payments.record", scopeType: "SELECTED_GROUPS", groupIds: [groupA.id] }],
      });
      const assistantContext: WorkspaceContext = { workspaceId: WORKSPACE_A, membership: assistantMembership };

      // In-scope: can pay Group A's obligation.
      await expect(
        service.recordPayment(assistantA, assistantContext, "key-a", { obligationId: obligationA.id, amountMinor: 1000, method: "CASH" }, null),
      ).resolves.toBeDefined();

      // Out-of-scope: cannot pay Group B's obligation.
      await expect(
        service.recordPayment(assistantA, assistantContext, "key-b", { obligationId: enrolledB.obligation.id, amountMinor: 1000, method: "CASH" }, null),
      ).rejects.toBeInstanceOf(ResourceNotFoundException);
    });
  });

  describe("Permission separation — payments.record does NOT imply finance.overview", () => {
    it("an assistant with ONLY payments.record can record a payment but cannot see the full finance summary", async () => {
      const { obligation } = await seedEnrolledStudent();

      const assistant: VerifiedSupabaseToken = { id: "u-assistant", email: "assistant@example.com" };
      const assistantMembership = teamRepo.seedMembership({ workspaceId: WORKSPACE_A, userId: assistant.id, roleLabel: "ASSISTANT" });
      await teamRepo.replaceMembershipGrants({
        workspaceId: WORKSPACE_A,
        membershipId: assistantMembership.id,
        createdByUserId: owner.id,
        desiredGrants: [{ permissionKey: "payments.record", scopeType: "SELECTED_GROUPS", groupIds: [groupA.id] }],
      });
      const assistantContext: WorkspaceContext = { workspaceId: WORKSPACE_A, membership: assistantMembership };

      await expect(
        service.recordPayment(assistant, assistantContext, randomUUID(), { obligationId: obligation.id, amountMinor: 1000, method: "CASH" }, null),
      ).resolves.toBeDefined();

      await expect(service.getFinanceSummary(assistant, assistantContext)).rejects.toBeInstanceOf(ForbiddenApiException);
    });
  });

  // ---------------------------------------------------------------------
  // Phase 15C — guard grant/membership reuse on the two hot read paths.
  // `getFinanceSummary` reuses the "finance.overview" grant the guard
  // already resolved; `getCollectionQueue` (an OR-permission route with no
  // single grant) reuses the ACTIVE membership the guard fetched. Both
  // sources are the SAME team repository the resolver uses. These prove the
  // reuse preserves scope EXACTLY, never lets `payments.record` satisfy
  // `finance.overview`, and does no extra permission resolution.
  // ---------------------------------------------------------------------
  describe("Phase 15C — guard grant/membership reuse", () => {
    async function withGuardGrant(context: WorkspaceContext, userId: string, permission: string): Promise<WorkspaceContext> {
      const grant = await resolver.hasPermission(context.workspaceId, userId, permission as never, context.membership);
      return { ...context, grant };
    }

    async function seedScopedAssistant(email: string, permissionKey: string, groupIds: string[]) {
      const user: VerifiedSupabaseToken = { id: `u-${email}`, email };
      const membership = teamRepo.seedMembership({ workspaceId: WORKSPACE_A, userId: user.id, roleLabel: "ASSISTANT" });
      await teamRepo.replaceMembershipGrants({
        workspaceId: WORKSPACE_A,
        membershipId: membership.id,
        createdByUserId: owner.id,
        desiredGrants: [{ permissionKey, scopeType: "SELECTED_GROUPS" as const, groupIds }],
      });
      return { user, context: { workspaceId: WORKSPACE_A, membership } as WorkspaceContext };
    }

    it("finance summary: reusing the finance.overview grant returns the same totals AND does zero extra resolution", async () => {
      await seedEnrolledStudent("طالب صيف");
      const fallback = await service.getFinanceSummary(owner, ownerContext);

      const ctxWithGrant = await withGuardGrant(ownerContext, owner.id, "finance.overview");
      teamRepo.findMembershipByUserAndWorkspaceCalls = 0;
      const reuse = await service.getFinanceSummary(owner, ctxWithGrant);

      expect(reuse).toEqual(fallback);
      expect(reuse.totalNetDueMinor).toBe(60000);
      expect(teamRepo.findMembershipByUserAndWorkspaceCalls).toBe(0);
    });

    it("finance summary: a stashed payments.record grant is NEVER accepted as finance.overview (invariant preserved)", async () => {
      await seedEnrolledStudent();
      const { user: assistant, context } = await seedScopedAssistant("pay-only@example.com", "payments.record", [groupA.id]);

      // Even if a payments.record grant is (defensively) present on the
      // context, the summary path must refuse it and resolve finance.overview
      // for real — which this assistant lacks.
      const payGrant = await resolver.hasPermission(WORKSPACE_A, assistant.id, "payments.record", context.membership);
      const ctx: WorkspaceContext = { ...context, grant: payGrant };
      await expect(service.getFinanceSummary(assistant, ctx)).rejects.toBeInstanceOf(ForbiddenApiException);
    });

    it("finance summary: a SELECTED_GROUPS finance.overview grant reused from the guard restricts totals to that scope", async () => {
      // Group A obligation (in scope) + a Group B obligation (out of scope).
      await seedEnrolledStudent("طالب أ");
      const groupB = shared.seedGroup({ workspaceId: WORKSPACE_A, name: "Group B" });
      const groupMonthB = shared.seedGroupMonth({ workspaceId: WORKSPACE_A, groupId: groupB.id, joinFeePolicy: "FULL", baseFeeMinor: 60000 });
      const studentB = await studentsService.createStudent(owner, ownerContext, { name: "طالب ب" }, null);
      const previewB = await enrollmentsService.previewEnrollment(owner, ownerContext, groupMonthB.id, { studentId: studentB.student.id, joinDate: "2026-08-01" });
      await enrollmentsService.createEnrollment(
        owner,
        ownerContext,
        groupMonthB.id,
        { studentId: studentB.student.id, joinDate: "2026-08-01", feeMethod: "FULL_MONTH", previewToken: previewB.previewToken },
        null,
      );

      const { user: assistant, context } = await seedScopedAssistant("overview-a@example.com", "finance.overview", [groupA.id]);
      const ctxWithGrant = await withGuardGrant(context, assistant.id, "finance.overview");
      const summary = await service.getFinanceSummary(assistant, ctxWithGrant);
      // Only Group A's single obligation is counted — Group B is invisible.
      expect(summary.totalNetDueMinor).toBe(60000);
      expect(summary.unpaidCount).toBe(1);
    });

    it("collection queue: the guard's ACTIVE membership hint is consumed — the queue resolves with zero membership re-queries", async () => {
      await seedEnrolledStudent("طالب قائمة");

      // Baseline: resolving a permission WITHOUT the hint re-queries the
      // membership from the team repository (no request-scoped memoization in
      // unit tests). This proves the counter is load-bearing.
      teamRepo.findMembershipByUserAndWorkspaceCalls = 0;
      await resolver.hasPermission(WORKSPACE_A, owner.id, "finance.overview");
      expect(teamRepo.findMembershipByUserAndWorkspaceCalls).toBeGreaterThan(0);

      // The endpoint passes the membership PermissionGuard already fetched, so
      // both OR-permission resolutions reuse it — zero additional fetches.
      teamRepo.findMembershipByUserAndWorkspaceCalls = 0;
      const reuse = await service.getCollectionQueue(owner, ownerContext);
      expect(reuse.items).toHaveLength(1);
      expect(teamRepo.findMembershipByUserAndWorkspaceCalls).toBe(0);
    });

    it("collection queue: a group-scoped payments.view_student_status caller sees only their group's queue", async () => {
      await seedEnrolledStudent("طالب أ"); // Group A obligation
      const groupB = shared.seedGroup({ workspaceId: WORKSPACE_A, name: "Group B" });
      const groupMonthB = shared.seedGroupMonth({ workspaceId: WORKSPACE_A, groupId: groupB.id, joinFeePolicy: "FULL", baseFeeMinor: 60000 });
      const studentB = await studentsService.createStudent(owner, ownerContext, { name: "طالب ب" }, null);
      const previewB = await enrollmentsService.previewEnrollment(owner, ownerContext, groupMonthB.id, { studentId: studentB.student.id, joinDate: "2026-08-01" });
      await enrollmentsService.createEnrollment(
        owner,
        ownerContext,
        groupMonthB.id,
        { studentId: studentB.student.id, joinDate: "2026-08-01", feeMethod: "FULL_MONTH", previewToken: previewB.previewToken },
        null,
      );

      const { user: assistant, context } = await seedScopedAssistant("queue-a@example.com", "payments.view_student_status", [groupA.id]);
      const queue = await service.getCollectionQueue(assistant, context);
      expect(queue.items).toHaveLength(1);
      expect(queue.items[0]!.studentName).toBe("طالب أ");
    });

    it("collection queue: a caller with NEITHER payments.view_student_status NOR finance.overview is forbidden", async () => {
      await seedEnrolledStudent();
      const { user: assistant, context } = await seedScopedAssistant("nobody@example.com", "attendance.read", [groupA.id]);
      await expect(service.getCollectionQueue(assistant, context)).rejects.toBeInstanceOf(ForbiddenApiException);
    });
  });
});
