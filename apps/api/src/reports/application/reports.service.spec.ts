import { randomUUID } from "node:crypto";
import type { GroupReportResult, MonthlyTeacherReportResult, StudentReportResult } from "@academic-precision/database";
import { ResourceNotFoundException } from "../../common/exceptions/api.exception";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import type { WorkspaceContext } from "../../team/api/guards/permission.guard";
import { PermissionResolverService } from "../../team/application/permission-resolver.service";
import { InMemoryTeamRepository } from "../../team/application/__fixtures__/in-memory-team.repository";
import { InMemoryReportsRepository } from "./__fixtures__/in-memory-reports.repository";
import { ReportsService } from "./reports.service";

const WORKSPACE_A = "workspace-a";
const GROUP_A = "group-a";
const GROUP_B = "group-b";

function emptyStudentReport(studentId: string): StudentReportResult {
  return {
    student: { id: studentId, name: "طالب تجريبي", studentCode: "AP-0001", status: "ACTIVE" },
    currentMonth: { id: "month-1", year: 2026, month: 8 },
    sessions: { total: 0, attendance: { present: 0, absent: 0, late: 0, missing: 0 }, homework: { done: 0, partial: 0, notDone: 0, noHomework: 0, missing: 0 }, exam: { scored: 0, absent: 0, missing: 0 } },
    activeAttentionCase: null,
    obligationsByMonth: [],
  };
}

describe("ReportsService", () => {
  let teamRepo: InMemoryTeamRepository;
  let resolver: PermissionResolverService;
  let reportsRepo: InMemoryReportsRepository;
  let service: ReportsService;

  let owner: VerifiedSupabaseToken;
  let ownerContext: WorkspaceContext;

  beforeEach(() => {
    teamRepo = new InMemoryTeamRepository();
    resolver = new PermissionResolverService(teamRepo);
    reportsRepo = new InMemoryReportsRepository();
    service = new ReportsService(reportsRepo, resolver);

    owner = { id: "u-owner", email: "owner@example.com" };
    const ownerMembership = teamRepo.seedMembership({ workspaceId: WORKSPACE_A, userId: owner.id, roleLabel: "OWNER" });
    ownerContext = { workspaceId: WORKSPACE_A, membership: ownerMembership };
  });

  it("Student Report: an Assistant scoped to Group A cannot see a student who only belongs to Group B — safe no-leak 404, not 403", async () => {
    const assistant: VerifiedSupabaseToken = { id: "u-assistant", email: "assistant@example.com" };
    const assistantMembership = teamRepo.seedMembership({ workspaceId: WORKSPACE_A, userId: assistant.id, roleLabel: "ASSISTANT" });
    await teamRepo.replaceMembershipGrants({
      workspaceId: WORKSPACE_A,
      membershipId: assistantMembership.id,
      createdByUserId: owner.id,
      desiredGrants: [{ permissionKey: "reports.view", scopeType: "SELECTED_GROUPS", groupIds: [GROUP_A] }],
    });
    const assistantContext: WorkspaceContext = { workspaceId: WORKSPACE_A, membership: assistantMembership };

    const studentInGroupB = randomUUID();
    reportsRepo.seedStudentGroups(studentInGroupB, [GROUP_B]);
    reportsRepo.seedStudentReport(WORKSPACE_A, studentInGroupB, emptyStudentReport(studentInGroupB));

    await expect(service.getStudentReport(assistant, assistantContext, studentInGroupB)).rejects.toBeInstanceOf(ResourceNotFoundException);
  });

  it("Student Report: the SAME Assistant CAN see a student in their own scoped Group A", async () => {
    const assistant: VerifiedSupabaseToken = { id: "u-assistant", email: "assistant@example.com" };
    const assistantMembership = teamRepo.seedMembership({ workspaceId: WORKSPACE_A, userId: assistant.id, roleLabel: "ASSISTANT" });
    await teamRepo.replaceMembershipGrants({
      workspaceId: WORKSPACE_A,
      membershipId: assistantMembership.id,
      createdByUserId: owner.id,
      desiredGrants: [{ permissionKey: "reports.view", scopeType: "SELECTED_GROUPS", groupIds: [GROUP_A] }],
    });
    const assistantContext: WorkspaceContext = { workspaceId: WORKSPACE_A, membership: assistantMembership };

    const studentInGroupA = randomUUID();
    reportsRepo.seedStudentGroups(studentInGroupA, [GROUP_A]);
    reportsRepo.seedStudentReport(WORKSPACE_A, studentInGroupA, emptyStudentReport(studentInGroupA));

    await expect(service.getStudentReport(assistant, assistantContext, studentInGroupA)).resolves.toBeDefined();
  });

  it("Owner (ALL_GROUPS) sees every student regardless of group", async () => {
    const studentId = randomUUID();
    reportsRepo.seedStudentGroups(studentId, [GROUP_B]);
    reportsRepo.seedStudentReport(WORKSPACE_A, studentId, emptyStudentReport(studentId));
    await expect(service.getStudentReport(owner, ownerContext, studentId)).resolves.toBeDefined();
  });

  it("Closure correction #1: Monthly Teacher Report never requires ALL_GROUPS — a SELECTED_GROUPS Assistant gets a report computed from THEIR visible groups only, not a 403", async () => {
    const assistant: VerifiedSupabaseToken = { id: "u-assistant", email: "assistant@example.com" };
    const assistantMembership = teamRepo.seedMembership({ workspaceId: WORKSPACE_A, userId: assistant.id, roleLabel: "ASSISTANT" });
    await teamRepo.replaceMembershipGrants({
      workspaceId: WORKSPACE_A,
      membershipId: assistantMembership.id,
      createdByUserId: owner.id,
      desiredGrants: [{ permissionKey: "reports.view", scopeType: "SELECTED_GROUPS", groupIds: [GROUP_A] }],
    });
    const assistantContext: WorkspaceContext = { workspaceId: WORKSPACE_A, membership: assistantMembership };

    const monthId = "month-1";
    const visibleOnlyResult: MonthlyTeacherReportResult = {
      month: { id: monthId, year: 2026, month: 8, status: "CURRENT" },
      groups: [{ groupId: GROUP_A, groupName: "المجموعة أ", studentsCount: 3, sessionsCount: 4 }], // Group B never appears
      totals: { studentsCount: 3, sessionsCount: 4, collection: { totalDueMinor: 30000, totalPaidMinor: 10000, totalRemainingMinor: 20000 }, overdueCount: 1, openAttentionCount: 0, openFollowupsCount: 0 },
    };
    reportsRepo.seedMonthlyReport(WORKSPACE_A, monthId, [GROUP_A], visibleOnlyResult);

    const result = await service.getMonthlyTeacherReport(assistant, assistantContext, monthId);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.groupId).toBe(GROUP_A);
    // No aggregate hints at Group B's existence — the repository was called with the SELECTED scope, never "ALL".
    expect(result.totals.studentsCount).toBe(3);
    // Finance redaction: this assistant has reports.view but NOT finance.overview,
    // so every money figure is nulled server-side (never merely UI-hidden).
    expect(result.totals.collection).toBeNull();
    expect(result.totals.overdueCount).toBeNull();
  });

  it("Empty month returns a valid zeroed report (200), never an error", async () => {
    const monthId = "month-empty";
    reportsRepo.seedMonthlyReport(WORKSPACE_A, monthId, "ALL", {
      month: { id: monthId, year: 2026, month: 8, status: "CURRENT" },
      groups: [],
      totals: { studentsCount: 0, sessionsCount: 0, collection: { totalDueMinor: 0, totalPaidMinor: 0, totalRemainingMinor: 0 }, overdueCount: 0, openAttentionCount: 0, openFollowupsCount: 0 },
    });
    const result = await service.getMonthlyTeacherReport(owner, ownerContext, monthId);
    expect(result.groups).toHaveLength(0);
    expect(result.totals.studentsCount).toBe(0);
  });

  it("An unknown/stale monthId is a safe 404, never a 500", async () => {
    await expect(service.getMonthlyTeacherReport(owner, ownerContext, "does-not-exist")).rejects.toBeInstanceOf(ResourceNotFoundException);
  });

  it("Finance redaction: an Owner (holds finance.overview) DOES receive the money figures", async () => {
    const monthId = "month-fin";
    reportsRepo.seedMonthlyReport(WORKSPACE_A, monthId, "ALL", {
      month: { id: monthId, year: 2026, month: 8, status: "CURRENT" },
      groups: [{ groupId: GROUP_A, groupName: "المجموعة أ", studentsCount: 3, sessionsCount: 4 }],
      totals: { studentsCount: 3, sessionsCount: 4, collection: { totalDueMinor: 30000, totalPaidMinor: 10000, totalRemainingMinor: 20000 }, overdueCount: 1, openAttentionCount: 0, openFollowupsCount: 0 },
    });
    const result = await service.getMonthlyTeacherReport(owner, ownerContext, monthId);
    expect(result.totals.collection).toEqual({ totalDueMinor: 30000, totalPaidMinor: 10000, totalRemainingMinor: 20000 });
    expect(result.totals.overdueCount).toBe(1);
  });

  it("Finance redaction: a Group report loses its collection for a non-finance caller", async () => {
    const assistant: VerifiedSupabaseToken = { id: "u-assistant", email: "assistant@example.com" };
    const assistantMembership = teamRepo.seedMembership({ workspaceId: WORKSPACE_A, userId: assistant.id, roleLabel: "ASSISTANT" });
    await teamRepo.replaceMembershipGrants({
      workspaceId: WORKSPACE_A,
      membershipId: assistantMembership.id,
      createdByUserId: owner.id,
      desiredGrants: [{ permissionKey: "reports.view", scopeType: "SELECTED_GROUPS", groupIds: [GROUP_A] }],
    });
    const assistantContext: WorkspaceContext = { workspaceId: WORKSPACE_A, membership: assistantMembership };
    const groupResult: GroupReportResult = {
      group: { id: GROUP_A, name: "المجموعة أ", status: "ACTIVE" },
      currentMonth: { id: "month-1", year: 2026, month: 8 },
      roster: [{ enrollmentId: randomUUID(), studentId: randomUUID(), studentName: "طالب", status: "ACTIVE" }],
      sessions: { total: 4, completed: 3 },
      attendance: { present: 3, absent: 1, late: 0, missing: 0 },
      homework: { done: 3, partial: 0, notDone: 1, noHomework: 0, missing: 0 },
      missingRecordsCount: 0,
      collection: { totalDueMinor: 30000, totalPaidMinor: 10000, totalRemainingMinor: 20000, overdueCount: 1 },
    };
    reportsRepo.seedGroupReport(WORKSPACE_A, GROUP_A, groupResult);
    const result = await service.getGroupReport(assistant, assistantContext, GROUP_A);
    expect(result.collection).toBeNull();
    expect(result.roster).toHaveLength(1); // non-finance data still present
  });

  it("Group Report: an Assistant with no scope at all for Group B gets a safe 404, never a 403 that confirms the group exists", async () => {
    const assistant: VerifiedSupabaseToken = { id: "u-assistant", email: "assistant@example.com" };
    const assistantMembership = teamRepo.seedMembership({ workspaceId: WORKSPACE_A, userId: assistant.id, roleLabel: "ASSISTANT" });
    await teamRepo.replaceMembershipGrants({
      workspaceId: WORKSPACE_A,
      membershipId: assistantMembership.id,
      createdByUserId: owner.id,
      desiredGrants: [{ permissionKey: "reports.view", scopeType: "SELECTED_GROUPS", groupIds: [GROUP_A] }],
    });
    const assistantContext: WorkspaceContext = { workspaceId: WORKSPACE_A, membership: assistantMembership };

    const groupReport: GroupReportResult = {
      group: { id: GROUP_B, name: "المجموعة ب", status: "ACTIVE" },
      currentMonth: null,
      roster: [],
      sessions: { total: 0, completed: 0 },
      attendance: { present: 0, absent: 0, late: 0, missing: 0 },
      homework: { done: 0, partial: 0, notDone: 0, noHomework: 0, missing: 0 },
      missingRecordsCount: 0,
      collection: { totalDueMinor: 0, totalPaidMinor: 0, totalRemainingMinor: 0, overdueCount: 0 },
    };
    reportsRepo.seedGroupReport(WORKSPACE_A, GROUP_B, groupReport);

    await expect(service.getGroupReport(assistant, assistantContext, GROUP_B)).rejects.toBeInstanceOf(ResourceNotFoundException);
  });

  it("Export download re-validates scope at DOWNLOAD time — losing access after creation blocks the download", async () => {
    const assistant: VerifiedSupabaseToken = { id: "u-assistant", email: "assistant@example.com" };
    const assistantMembership = teamRepo.seedMembership({ workspaceId: WORKSPACE_A, userId: assistant.id, roleLabel: "ASSISTANT" });
    await teamRepo.replaceMembershipGrants({
      workspaceId: WORKSPACE_A,
      membershipId: assistantMembership.id,
      createdByUserId: owner.id,
      desiredGrants: [
        { permissionKey: "reports.export", scopeType: "SELECTED_GROUPS", groupIds: [GROUP_A] },
        { permissionKey: "reports.view", scopeType: "SELECTED_GROUPS", groupIds: [GROUP_A] },
      ],
    });
    const assistantContext: WorkspaceContext = { workspaceId: WORKSPACE_A, membership: assistantMembership };

    const studentId = randomUUID();
    reportsRepo.seedStudentGroups(studentId, [GROUP_A]);
    reportsRepo.seedStudentReport(WORKSPACE_A, studentId, emptyStudentReport(studentId));

    const created = await service.createExport(assistant, assistantContext, { type: "STUDENT", format: "CSV", studentId });
    expect(created.status).toBe("READY");

    // Download while still in scope succeeds.
    await expect(service.downloadExport(assistant, assistantContext, created.exportId)).resolves.toBeDefined();

    // Scope is revoked (student re-scoped to Group B only) — the SAME export id must now be blocked.
    reportsRepo.seedStudentGroups(studentId, [GROUP_B]);
    await expect(service.downloadExport(assistant, assistantContext, created.exportId)).rejects.toBeInstanceOf(ResourceNotFoundException);
  });

  it("an expired export cannot be downloaded", async () => {
    const studentId = randomUUID();
    reportsRepo.seedStudentGroups(studentId, []);
    reportsRepo.seedStudentReport(WORKSPACE_A, studentId, emptyStudentReport(studentId));
    const created = await service.createExport(owner, ownerContext, { type: "STUDENT", format: "CSV", studentId });

    const row = reportsRepo.exportsById.get(created.exportId)!;
    reportsRepo.exportsById.set(created.exportId, { ...row, expiresAt: new Date(Date.now() - 1000) });

    await expect(service.downloadExport(owner, ownerContext, created.exportId)).rejects.toThrow();
  });
});
