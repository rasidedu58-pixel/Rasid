import { QrInvalidException, ResourceNotFoundException } from "../../common/exceptions/api.exception";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import type { WorkspaceContext } from "../../team/api/guards/permission.guard";
import { PermissionResolverService } from "../../team/application/permission-resolver.service";
import { InMemoryTeamRepository } from "../../team/application/__fixtures__/in-memory-team.repository";
import { PreviewTokenService } from "../../scheduling/application/preview-token.service";
import { InMemoryStudentsRepository } from "./__fixtures__/in-memory-students.repository";
import { StudentsService } from "./students.service";
import { EnrollmentsService } from "./enrollments.service";

/**
 * Student Group-Scope Security Delta — dedicated regression suite.
 *
 * PRD §35 (`PERMISSION_SCOPE_KIND["students.view_basic"|"students.edit"] ===
 * "GROUP"`) and API Contract §10 ("Student view/edit: ... Scope: Group")
 * both require `students.view_basic`/`students.edit` to be enforced as
 * real Group Scope for SELECTED_GROUPS callers — NOT the coarse
 * workspace-wide check the original Phase 4 implementation used. This file
 * proves the fix against the 10 scenarios required by the delta brief:
 * an Assistant scoped to Group A only must never see/touch a Group B
 * Student/Guardian/QR/Enrollment, while an Owner/ALL_GROUPS caller and
 * cross-workspace isolation stay unaffected.
 */
describe("Student Group-Scope Security Delta", () => {
  const WORKSPACE_A = "workspace-a";
  const WORKSPACE_B = "workspace-b";

  let repo: InMemoryStudentsRepository;
  let teamRepo: InMemoryTeamRepository;
  let resolver: PermissionResolverService;
  let previewTokens: PreviewTokenService;
  let studentsService: StudentsService;
  let enrollmentsService: EnrollmentsService;

  let owner: VerifiedSupabaseToken;
  let ownerContext: WorkspaceContext;
  let assistantA: VerifiedSupabaseToken;
  let assistantAContext: WorkspaceContext;

  let groupA: ReturnType<InMemoryStudentsRepository["seedGroup"]>;
  let groupB: ReturnType<InMemoryStudentsRepository["seedGroup"]>;
  let groupMonthA: ReturnType<InMemoryStudentsRepository["seedGroupMonth"]>;
  let groupMonthB: ReturnType<InMemoryStudentsRepository["seedGroupMonth"]>;

  beforeEach(async () => {
    repo = new InMemoryStudentsRepository();
    teamRepo = new InMemoryTeamRepository();
    resolver = new PermissionResolverService(teamRepo);
    previewTokens = new PreviewTokenService();
    studentsService = new StudentsService(repo, resolver);
    enrollmentsService = new EnrollmentsService(repo, resolver, previewTokens);

    owner = { id: "u-owner", email: "owner@example.com" };
    const ownerMembership = teamRepo.seedMembership({ workspaceId: WORKSPACE_A, userId: owner.id, roleLabel: "OWNER" });
    ownerContext = { workspaceId: WORKSPACE_A, membership: ownerMembership };

    groupA = repo.seedGroup({ workspaceId: WORKSPACE_A, name: "Group A" });
    groupB = repo.seedGroup({ workspaceId: WORKSPACE_A, name: "Group B" });
    groupMonthA = repo.seedGroupMonth({ workspaceId: WORKSPACE_A, groupId: groupA.id, joinFeePolicy: "FULL" });
    groupMonthB = repo.seedGroupMonth({ workspaceId: WORKSPACE_A, groupId: groupB.id, joinFeePolicy: "FULL" });

    assistantA = { id: "u-assistant-a", email: "assistant-a@example.com" };
    const assistantMembership = teamRepo.seedMembership({
      workspaceId: WORKSPACE_A,
      userId: assistantA.id,
      roleLabel: "ASSISTANT",
    });
    await teamRepo.replaceMembershipGrants({
      workspaceId: WORKSPACE_A,
      membershipId: assistantMembership.id,
      createdByUserId: owner.id,
      desiredGrants: [{ permissionKey: "students.edit", scopeType: "SELECTED_GROUPS", groupIds: [groupA.id] }],
    });
    assistantAContext = { workspaceId: WORKSPACE_A, membership: assistantMembership };
  });

  /** Creates a Student and immediately Enrolls them into `groupMonth`, returning the Student DTO. */
  async function seedEnrolledStudent(name: string, groupMonthId: string) {
    const created = await studentsService.createStudent(owner, ownerContext, { name }, null);
    await repo.createOrReactivateEnrollmentTransaction({
      workspaceId: WORKSPACE_A,
      studentId: created.student.id,
      groupMonthId,
      joinDate: "2026-08-01",
      status: "ACTIVE",
      feeMethod: "FULL_MONTH",
    });
    return created;
  }

  it("1. Assistant in Group A يرى طالب Group A", async () => {
    const studentA = await seedEnrolledStudent("طالب أ", groupMonthA.id);
    const detail = await studentsService.getStudent(assistantA, assistantAContext, studentA.student.id);
    expect(detail.student.id).toBe(studentA.student.id);
  });

  it("2. نفس Assistant لا يرى طالب Group B في نفس Workspace", async () => {
    const studentB = await seedEnrolledStudent("طالب ب", groupMonthB.id);
    await expect(
      studentsService.getStudent(assistantA, assistantAContext, studentB.student.id),
    ).rejects.toBeInstanceOf(ResourceNotFoundException);
  });

  it("3. Student list/search لا يعرض Group B", async () => {
    const studentA = await seedEnrolledStudent("طالب أ", groupMonthA.id);
    const studentB = await seedEnrolledStudent("طالب ب", groupMonthB.id);

    const results = await studentsService.listStudents(assistantA, assistantAContext, {});
    const ids = results.items.map((s) => s.id);
    expect(ids).toContain(studentA.student.id);
    expect(ids).not.toContain(studentB.student.id);
  });

  it("4. match-preview لا يكشف Group B", async () => {
    const studentB = await seedEnrolledStudent("سلمى الفريدة", groupMonthB.id);

    const preview = await studentsService.matchPreview(assistantA, assistantAContext, { name: "سلمى الفريدة" });
    expect(preview.candidates.map((c) => c.studentId)).not.toContain(studentB.student.id);
  });

  it("5. QR لطالب Group B لا يُresolve للمساعد المحدود بـGroup A", async () => {
    const studentB = await seedEnrolledStudent("طالب ب", groupMonthB.id);
    await expect(
      studentsService.resolveQr(assistantA, assistantAContext, {
        token: studentB.qr.displayToken,
        context: "GLOBAL",
      }),
    ).rejects.toBeInstanceOf(QrInvalidException);
  });

  it("6. لا يستطيع تعديل/أرشفة طالب Group B", async () => {
    const studentB = await seedEnrolledStudent("طالب ب", groupMonthB.id);
    await expect(
      studentsService.updateStudent(
        assistantA,
        assistantAContext,
        studentB.student.id,
        { version: studentB.student.version, name: "x" },
        null,
      ),
    ).rejects.toBeInstanceOf(ResourceNotFoundException);
    await expect(
      studentsService.archiveStudent(assistantA, assistantAContext, studentB.student.id, null),
    ).rejects.toBeInstanceOf(ResourceNotFoundException);
  });

  it("7. لا يستطيع قراءة أو تعديل Guardians لطالب Group B", async () => {
    const studentB = await seedEnrolledStudent("طالب ب", groupMonthB.id);
    await expect(
      studentsService.linkGuardian(
        assistantA,
        assistantAContext,
        studentB.student.id,
        { phone: "+201000000009" },
        null,
      ),
    ).rejects.toBeInstanceOf(ResourceNotFoundException);

    // Also confirm no guardians leak via the (rejected) detail read.
    await expect(
      studentsService.getStudent(assistantA, assistantAContext, studentB.student.id),
    ).rejects.toBeInstanceOf(ResourceNotFoundException);
  });

  it("8. لا يستطيع إنشاء/سحب/نقل Enrollment خارج Group Scope", async () => {
    const studentB = await seedEnrolledStudent("طالب ب", groupMonthB.id);

    // Create: target GroupMonth (B) is out of scope.
    await expect(
      enrollmentsService.previewEnrollment(assistantA, assistantAContext, groupMonthB.id, {
        studentId: studentB.student.id,
        joinDate: "2026-08-01",
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundException);

    // Withdraw/transfer: the existing enrollment itself is anchored to
    // GroupMonth B (out of scope) even though the assistant supplies its id
    // directly.
    const existing = await repo.findEnrollmentByStudentAndGroupMonth(studentB.student.id, groupMonthB.id);
    expect(existing).toBeDefined();
    await expect(
      enrollmentsService.withdrawEnrollment(assistantA, assistantAContext, existing!.id, {}, null),
    ).rejects.toBeInstanceOf(ResourceNotFoundException);
    await expect(
      enrollmentsService.transferPreview(assistantA, assistantAContext, existing!.id, {
        targetGroupMonthId: groupMonthA.id,
        feeMethod: "FULL_MONTH",
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundException);
  });

  it("9. Owner وALL_GROUPS لا يتأثران", async () => {
    const studentA = await seedEnrolledStudent("طالب أ", groupMonthA.id);
    const studentB = await seedEnrolledStudent("طالب ب", groupMonthB.id);

    await expect(studentsService.getStudent(owner, ownerContext, studentA.student.id)).resolves.toBeDefined();
    await expect(studentsService.getStudent(owner, ownerContext, studentB.student.id)).resolves.toBeDefined();

    const results = await studentsService.listStudents(owner, ownerContext, {});
    const ids = results.items.map((s) => s.id);
    expect(ids).toContain(studentA.student.id);
    expect(ids).toContain(studentB.student.id);
  });

  it("10. Cross-workspace isolation يظل ناجحًا (بالإضافة لـGroup Scope)", async () => {
    const foreignStudent = repo.seedStudent({ workspaceId: WORKSPACE_B, studentCode: "AP-FOREIGN", name: "خارجي" });
    await expect(
      studentsService.getStudent(assistantA, assistantAContext, foreignStudent.id),
    ).rejects.toBeInstanceOf(ResourceNotFoundException);
    // Owner of workspace A is likewise never granted cross-workspace reach.
    await expect(
      studentsService.getStudent(owner, ownerContext, foreignStudent.id),
    ).rejects.toBeInstanceOf(ResourceNotFoundException);
  });
});
