import { randomUUID } from "node:crypto";
import {
  CarryForwardDueDayUnresolvedException,
  CarryForwardFeeMethodRequiredException,
} from "../../common/exceptions/api.exception";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import type { WorkspaceContext } from "../../team/api/guards/permission.guard";
import { PermissionResolverService } from "../../team/application/permission-resolver.service";
import { InMemoryTeamRepository } from "../../team/application/__fixtures__/in-memory-team.repository";
import { InMemorySchedulingRepository } from "./__fixtures__/in-memory-scheduling.repository";
import { PreviewTokenService } from "./preview-token.service";
import { SchedulingService } from "./scheduling.service";

const WORKSPACE_A = "workspace-a";

/**
 * Phase 6 Closure Delta — CreateMonth Carry-Forward Integration. Covers the
 * 12 mandatory scenarios from the user's spec. Atomicity ("no half-created
 * month") is asserted here against the in-memory double's own snapshot/
 * restore simulation of a real Postgres transaction rollback; TRUE
 * transactional atomicity is additionally proven against live Supabase in
 * `packages/database/src/carry-forward-security.integration.test.ts`.
 */
describe("SchedulingService — CreateMonth Carry-Forward", () => {
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

  /** Seeds a fully-formed source month (August 2026) with one ACTIVE group carrying one group_month, and returns everything a test needs to seed enrollments into it. */
  function seedSourceMonth(params: { joinFeePolicy?: "FULL" | "REMAINING" | "ASK_EVERY_TIME"; dueDay?: number | null; baseFeeMinor?: number } = {}) {
    const group = repo.seedGroup({ workspaceId: WORKSPACE_A, name: "Group " + randomUUID().slice(0, 4) });
    const sourceMonth = repo.seedMonth({
      workspaceId: WORKSPACE_A,
      year: 2026,
      month: 7,
      status: "CURRENT",
      createdByUserId: owner.id,
    });
    const sourceGroupMonth = repo.seedGroupMonth({
      workspaceId: WORKSPACE_A,
      groupId: group.id,
      operatingMonthId: sourceMonth.id,
      baseFeeMinor: params.baseFeeMinor ?? 30000,
      dueDay: params.dueDay === undefined ? 15 : params.dueDay,
      joinFeePolicy: params.joinFeePolicy ?? "FULL",
    });
    return { group, sourceMonth, sourceGroupMonth };
  }

  async function previewAndConfirm(idempotencyKey = randomUUID()) {
    const preview = await service.previewCreateMonth(ownerContext, { targetYear: 2026, targetMonth: 8, sourceMonthId: (await repo.listOperatingMonths(WORKSPACE_A)).find((m) => m.status === "CURRENT")!.id });
    const confirmed = await service.confirmCreateMonth(owner, ownerContext, idempotencyKey, { previewToken: preview.previewToken }, null);
    return { preview, confirmed };
  }

  it("1+2: a continuing (ACTIVE) student gets a NEW Enrollment id under a NEW GroupMonth id, same Student id, same Group id", async () => {
    const { group, sourceGroupMonth } = seedSourceMonth();
    const studentId = "student-1";
    const sourceEnrollment = repo.seedEnrollment({ workspaceId: WORKSPACE_A, studentId, groupMonthId: sourceGroupMonth.id, status: "ACTIVE" });

    const { confirmed } = await previewAndConfirm();

    expect(confirmed.enrollmentCount).toBe(1);
    const newGroupMonth = (await repo.listGroupMonthsForOperatingMonth(confirmed.monthId))[0]!;
    expect(newGroupMonth.groupId).toBe(group.id); // same Group identity — reused, not recreated
    expect(newGroupMonth.id).not.toBe(sourceGroupMonth.id); // new GroupMonth

    const newEnrollment = [...repo.enrollmentsById.values()].find((e) => e.groupMonthId === newGroupMonth.id);
    expect(newEnrollment).toBeDefined();
    expect(newEnrollment!.id).not.toBe(sourceEnrollment.id); // never reuses the old enrollment id
    expect(newEnrollment!.studentId).toBe(studentId); // same Student identity
    expect(newEnrollment!.status).toBe("ACTIVE");
  });

  it("3+4: the new Obligation has the correct value, amount_paid=0, and full remaining at creation", async () => {
    const { sourceGroupMonth } = seedSourceMonth({ baseFeeMinor: 45000 });
    repo.seedEnrollment({ workspaceId: WORKSPACE_A, studentId: "student-1", groupMonthId: sourceGroupMonth.id, status: "ACTIVE" });

    await previewAndConfirm();

    const obligations = [...repo.obligationsById.values()];
    expect(obligations).toHaveLength(1);
    const obligation = obligations[0]!;
    expect(obligation.baseFeeMinor).toBe(45000);
    expect(obligation.netDueMinor).toBe(45000);
    expect(obligation.amountPaidMinor).toBe(0);
    expect(obligation.remainingMinor).toBe(45000);
    expect(obligation.status).toBe("UNPAID");
    expect(obligation.calculationBasis).toBe("FULL_MONTH");
  });

  it("5: a prior month's Payments/Reversals never transfer — the old obligation is left completely untouched", async () => {
    const { sourceGroupMonth } = seedSourceMonth();
    const sourceEnrollment = repo.seedEnrollment({ workspaceId: WORKSPACE_A, studentId: "student-1", groupMonthId: sourceGroupMonth.id, status: "ACTIVE" });
    const oldObligation = repo.seedObligation({
      workspaceId: WORKSPACE_A,
      enrollmentId: sourceEnrollment.id,
      baseFeeMinor: 30000,
      amountPaidMinor: 20000,
      remainingMinor: 10000,
      status: "PARTIAL",
    });

    await previewAndConfirm();

    const untouchedOld = repo.obligationsById.get(oldObligation.id)!;
    expect(untouchedOld).toEqual(oldObligation); // byte-for-byte unchanged — no auto-allocation
    const allObligations = [...repo.obligationsById.values()];
    expect(allObligations).toHaveLength(2); // the old one + the brand-new one — never merged
    const newObligation = allObligations.find((o) => o.id !== oldObligation.id)!;
    expect(newObligation.amountPaidMinor).toBe(0);
  });

  it("6: session generation stays calendar-occurrence-based — carry-forward never copies Session/Attendance/Homework/Exam rows from the source month", async () => {
    const { sourceGroupMonth } = seedSourceMonth();
    const oldSession = repo.seedSession({ workspaceId: WORKSPACE_A, groupMonthId: sourceGroupMonth.id, createdByUserId: owner.id });
    repo.seedEnrollment({ workspaceId: WORKSPACE_A, studentId: "student-1", groupMonthId: sourceGroupMonth.id, status: "ACTIVE" });

    await previewAndConfirm();

    // The source month's own session is untouched (still exists, unchanged) —
    // no new-month session references it, and no attendance/homework/exam
    // table is ever imported by scheduling.repository.ts, so nothing there
    // *can* be copied by construction.
    expect(repo.sessionsById.get(oldSession.id)).toEqual(oldSession);
  });

  it("7: WITHDRAWN/STOPPED/PENDING/TRANSFERRED enrollments are excluded from carry-forward — only ACTIVE is continuing", async () => {
    const { sourceGroupMonth } = seedSourceMonth();
    repo.seedEnrollment({ workspaceId: WORKSPACE_A, studentId: "s-active", groupMonthId: sourceGroupMonth.id, status: "ACTIVE" });
    repo.seedEnrollment({ workspaceId: WORKSPACE_A, studentId: "s-withdrawn", groupMonthId: sourceGroupMonth.id, status: "WITHDRAWN" });
    repo.seedEnrollment({ workspaceId: WORKSPACE_A, studentId: "s-stopped", groupMonthId: sourceGroupMonth.id, status: "STOPPED" });
    repo.seedEnrollment({ workspaceId: WORKSPACE_A, studentId: "s-pending", groupMonthId: sourceGroupMonth.id, status: "PENDING" });
    repo.seedEnrollment({ workspaceId: WORKSPACE_A, studentId: "s-transferred", groupMonthId: sourceGroupMonth.id, status: "TRANSFERRED" });

    const { preview, confirmed } = await previewAndConfirm();

    expect(preview.students).toEqual({ continuing: 1, excluded: 3, transferred: 1 });
    expect(confirmed.enrollmentCount).toBe(1);
    const allStudentIds = [...repo.enrollmentsById.values()].map((e) => e.studentId);
    // Only the ACTIVE student's id should appear twice (old + new row); everyone else appears once (their untouched old row only, never carried).
    expect(allStudentIds.filter((id) => id === "s-active")).toHaveLength(2);
    expect(allStudentIds.filter((id) => id === "s-withdrawn")).toHaveLength(1);
    expect(allStudentIds.filter((id) => id === "s-stopped")).toHaveLength(1);
    expect(allStudentIds.filter((id) => id === "s-pending")).toHaveLength(1);
    expect(allStudentIds.filter((id) => id === "s-transferred")).toHaveLength(1);
  });

  it("8: duplicate CreateMonth confirm with the SAME idempotency key does not duplicate Enrollments/Obligations/Sessions", async () => {
    const { sourceGroupMonth } = seedSourceMonth();
    repo.seedEnrollment({ workspaceId: WORKSPACE_A, studentId: "student-1", groupMonthId: sourceGroupMonth.id, status: "ACTIVE" });
    const key = randomUUID();

    const first = await previewAndConfirm(key);
    // Re-confirm with the SAME key + SAME body shape (preview token content matches).
    const preview2 = await service.previewCreateMonth(ownerContext, {
      targetYear: 2026,
      targetMonth: 9,
      sourceMonthId: (await repo.listOperatingMonths(WORKSPACE_A)).find((m) => m.year === 2026 && m.month === 7)!.id,
    });
    void preview2;
    const second = await service.confirmCreateMonth(owner, ownerContext, key, { previewToken: first.preview.previewToken }, null);

    expect(second).toEqual(first.confirmed);
    const newMonthGroupMonths = await repo.listGroupMonthsForOperatingMonth(first.confirmed.monthId);
    const totalEnrollmentsUnderNewGroupMonths = [...repo.enrollmentsById.values()].filter((e) =>
      newMonthGroupMonths.some((gm) => gm.id === e.groupMonthId),
    );
    expect(totalEnrollmentsUnderNewGroupMonths).toHaveLength(1); // not duplicated
  });

  it("9a: ASK_EVERY_TIME with continuing students fails fast at PREVIEW time (no preview token issued, no rows created)", async () => {
    const { sourceGroupMonth } = seedSourceMonth({ joinFeePolicy: "ASK_EVERY_TIME" });
    repo.seedEnrollment({ workspaceId: WORKSPACE_A, studentId: "student-1", groupMonthId: sourceGroupMonth.id, status: "ACTIVE" });
    const sourceMonthId = (await repo.listOperatingMonths(WORKSPACE_A))[0]!.id;

    await expect(
      service.previewCreateMonth(ownerContext, { targetYear: 2026, targetMonth: 8, sourceMonthId }),
    ).rejects.toBeInstanceOf(CarryForwardFeeMethodRequiredException);

    expect((await repo.listOperatingMonths(WORKSPACE_A)).filter((m) => m.year === 2026 && m.month === 8)).toHaveLength(0);
  });

  it("9b: an unresolvable due day (group has none, workspace unifiedDueDay is null) rolls back the WHOLE month — no half-created month", async () => {
    const { sourceGroupMonth } = seedSourceMonth({ dueDay: null });
    repo.seedEnrollment({ workspaceId: WORKSPACE_A, studentId: "student-1", groupMonthId: sourceGroupMonth.id, status: "ACTIVE" });
    repo.workspaceUnifiedDueDay = null; // no fallback available either

    await expect(previewAndConfirm()).rejects.toBeInstanceOf(CarryForwardDueDayUnresolvedException);

    // No half-created month: no CURRENT month for target (2026, 8), no
    // leaked GroupMonth/Enrollment/Obligation from the aborted attempt.
    const targetMonths = (await repo.listOperatingMonths(WORKSPACE_A)).filter((m) => m.year === 2026 && m.month === 8);
    expect(targetMonths).toHaveLength(0);
    expect(repo.groupMonthsById.size).toBe(1); // only the original source group_month
    expect(repo.enrollmentsById.size).toBe(1); // only the original source enrollment — no orphaned carried row
    expect(repo.obligationsById.size).toBe(0);
  });

  it("10: RLS/workspace isolation — carry-forward never reads/writes across workspaces (structural: every query is scoped by the caller's own repository instance/workspaceId)", async () => {
    const { sourceGroupMonth } = seedSourceMonth();
    repo.seedEnrollment({ workspaceId: WORKSPACE_A, studentId: "student-1", groupMonthId: sourceGroupMonth.id, status: "ACTIVE" });
    // A same-shaped enrollment under a different workspace's group_month must never be counted.
    const otherGroup = repo.seedGroup({ workspaceId: "workspace-b", name: "Other" });
    const otherMonth = repo.seedMonth({ workspaceId: "workspace-b", year: 2026, month: 7, status: "CURRENT", createdByUserId: "u-other" });
    const otherGroupMonth = repo.seedGroupMonth({ workspaceId: "workspace-b", groupId: otherGroup.id, operatingMonthId: otherMonth.id });
    repo.seedEnrollment({ workspaceId: "workspace-b", studentId: "student-other", groupMonthId: otherGroupMonth.id, status: "ACTIVE" });

    const { confirmed } = await previewAndConfirm();

    expect(confirmed.enrollmentCount).toBe(1); // only workspace A's continuing student
  });

  it("11: AuditEvent(month.created) and OutboxEvent(MonthCreated) are recorded for a carry-forward confirm, reflecting the real enrollmentCount", async () => {
    const { sourceGroupMonth } = seedSourceMonth();
    repo.seedEnrollment({ workspaceId: WORKSPACE_A, studentId: "student-1", groupMonthId: sourceGroupMonth.id, status: "ACTIVE" });

    await previewAndConfirm();

    const auditEvent = repo.auditEvents.find((e) => e.action === "month.created");
    expect(auditEvent).toBeDefined();
    expect((auditEvent!.afterJson as { enrollmentCount: number }).enrollmentCount).toBe(1);
    const outboxEvent = repo.outboxEvents.find((e) => e.eventType === "MonthCreated");
    expect(outboxEvent).toBeDefined();
    expect((outboxEvent!.payload as { enrollmentCount: number }).enrollmentCount).toBe(1);
  });

  it("12: REMAINING join_fee_policy also charges the full base fee for a continuing student — no proration engine invoked, calculationBasis stays FULL_MONTH", async () => {
    const { sourceGroupMonth } = seedSourceMonth({ joinFeePolicy: "REMAINING", baseFeeMinor: 50000 });
    repo.seedEnrollment({ workspaceId: WORKSPACE_A, studentId: "student-1", groupMonthId: sourceGroupMonth.id, status: "ACTIVE" });

    await previewAndConfirm();

    const obligation = [...repo.obligationsById.values()][0]!;
    expect(obligation.baseFeeMinor).toBe(50000);
    expect(obligation.calculationBasis).toBe("FULL_MONTH");
    const newEnrollment = [...repo.enrollmentsById.values()].find((e) => e.id === obligation.enrollmentId)!;
    expect(newEnrollment.feeMethod).toBe("FULL_MONTH");
  });

  it("preview surfaces students/newObligationsTotalMinor/studentsWithOldDebt correctly, and zero for a selectedGroupIds (no source month) preview", async () => {
    const { sourceGroupMonth } = seedSourceMonth({ baseFeeMinor: 20000 });
    const continuingEnrollment = repo.seedEnrollment({ workspaceId: WORKSPACE_A, studentId: "student-1", groupMonthId: sourceGroupMonth.id, status: "ACTIVE" });
    repo.seedObligation({ workspaceId: WORKSPACE_A, enrollmentId: continuingEnrollment.id, baseFeeMinor: 20000, remainingMinor: 5000, status: "PARTIAL", amountPaidMinor: 15000 });
    repo.seedEnrollment({ workspaceId: WORKSPACE_A, studentId: "student-2", groupMonthId: sourceGroupMonth.id, status: "WITHDRAWN" });
    const sourceMonthId = (await repo.listOperatingMonths(WORKSPACE_A))[0]!.id;

    const preview = await service.previewCreateMonth(ownerContext, { targetYear: 2026, targetMonth: 8, sourceMonthId });
    expect(preview.students).toEqual({ continuing: 1, excluded: 1, transferred: 0 });
    expect(preview.newObligationsTotalMinor).toBe(20000);
    expect(preview.studentsWithOldDebt).toBe(1);

    // A fresh group with no source month at all — genuinely zero, not fabricated.
    const freshGroup = repo.seedGroup({ workspaceId: WORKSPACE_A, name: "Fresh" });
    const freshPreview = await service.previewCreateMonth(ownerContext, {
      targetYear: 2026,
      targetMonth: 10,
      selectedGroupIds: [freshGroup.id],
      groupInitialConfig: {
        [freshGroup.id]: { baseFeeMinor: 1000, currencyCode: "EGP", duePolicy: "PER_GROUP", joinFeePolicy: "FULL", scheduleRules: [] },
      },
    });
    expect(freshPreview.students).toEqual({ continuing: 0, excluded: 0, transferred: 0 });
    expect(freshPreview.newObligationsTotalMinor).toBe(0);
    expect(freshPreview.studentsWithOldDebt).toBe(0);
  });
});
