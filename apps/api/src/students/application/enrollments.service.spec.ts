import {
  enrollmentTransferPreviewRequestSchema,
  enrollmentTransferRequestSchema,
} from "@academic-precision/contracts";
import { ResourceNotFoundException, ValidationApiException } from "../../common/exceptions/api.exception";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import type { WorkspaceContext } from "../../team/api/guards/permission.guard";
import { PermissionResolverService } from "../../team/application/permission-resolver.service";
import { InMemoryTeamRepository } from "../../team/application/__fixtures__/in-memory-team.repository";
import { PreviewTokenService } from "../../scheduling/application/preview-token.service";
import { InMemoryStudentsRepository } from "./__fixtures__/in-memory-students.repository";
import { StudentsService } from "./students.service";
import { EnrollmentsService } from "./enrollments.service";

const WORKSPACE_A = "workspace-a";

describe("EnrollmentsService", () => {
  let repo: InMemoryStudentsRepository;
  let teamRepo: InMemoryTeamRepository;
  let resolver: PermissionResolverService;
  let previewTokens: PreviewTokenService;
  let studentsService: StudentsService;
  let service: EnrollmentsService;

  let owner: VerifiedSupabaseToken;
  let ownerContext: WorkspaceContext;

  beforeEach(() => {
    repo = new InMemoryStudentsRepository();
    teamRepo = new InMemoryTeamRepository();
    resolver = new PermissionResolverService(teamRepo);
    previewTokens = new PreviewTokenService();
    studentsService = new StudentsService(repo, resolver);
    service = new EnrollmentsService(repo, resolver, previewTokens);

    owner = { id: "u-owner", email: "owner@example.com" };
    const ownerMembership = teamRepo.seedMembership({ workspaceId: WORKSPACE_A, userId: owner.id, roleLabel: "OWNER" });
    ownerContext = { workspaceId: WORKSPACE_A, membership: ownerMembership };
  });

  function seedGroupMonth(overrides: Partial<Parameters<InMemoryStudentsRepository["seedGroupMonth"]>[0]> = {}) {
    const group = repo.seedGroup({ workspaceId: WORKSPACE_A, name: "Group" });
    return repo.seedGroupMonth({
      workspaceId: WORKSPACE_A,
      groupId: group.id,
      baseFeeMinor: 60000,
      joinFeePolicy: "ASK_EVERY_TIME",
      ...overrides,
    });
  }

  async function seedStudent(name = "طالب") {
    const created = await studentsService.createStudent(owner, ownerContext, { name }, null);
    return created.student;
  }

  describe("fee method resolution", () => {
    it("FULL policy forces FULL_MONTH regardless of requested feeMethod", async () => {
      const gm = seedGroupMonth({ joinFeePolicy: "FULL", baseFeeMinor: 50000 });
      const student = await seedStudent();
      const preview = await service.previewEnrollment(owner, ownerContext, gm.id, {
        studentId: student.id,
        joinDate: "2026-08-01",
      });
      expect(preview.formula).toBe("FULL_MONTH");
      expect(preview.calculatedDueMinor).toBe(50000);
    });

    it("ASK_EVERY_TIME requires an explicit feeMethod", async () => {
      const gm = seedGroupMonth({ joinFeePolicy: "ASK_EVERY_TIME" });
      const student = await seedStudent();
      await expect(
        service.previewEnrollment(owner, ownerContext, gm.id, { studentId: student.id, joinDate: "2026-08-01" }),
      ).rejects.toBeInstanceOf(ValidationApiException);
    });
  });

  describe("REMAINING_SESSIONS proration end-to-end", () => {
    it("computes the exact PRD AC-07 example via preview and persists the enrollment on create", async () => {
      const gm = seedGroupMonth({ joinFeePolicy: "REMAINING", baseFeeMinor: 60000 });
      for (let i = 0; i < 5; i += 1) {
        repo.seedSession({
          workspaceId: WORKSPACE_A,
          groupMonthId: gm.id,
          createdByUserId: owner.id,
          scheduledAt: new Date(Date.UTC(2026, 7, 1 + i, 8, 0, 0)),
        });
      }
      for (let i = 0; i < 3; i += 1) {
        repo.seedSession({
          workspaceId: WORKSPACE_A,
          groupMonthId: gm.id,
          createdByUserId: owner.id,
          scheduledAt: new Date(Date.UTC(2026, 7, 15 + i, 8, 0, 0)),
        });
      }
      const student = await seedStudent();

      const preview = await service.previewEnrollment(owner, ownerContext, gm.id, {
        studentId: student.id,
        joinDate: "2026-08-15",
      });
      expect(preview.calculatedDueMinor).toBe(22500);
      expect(preview.eligibleSessions).toBe(3);
      expect(preview.totalBillableSessions).toBe(8);

      const created = await service.createEnrollment(
        owner,
        ownerContext,
        gm.id,
        {
          studentId: student.id,
          joinDate: "2026-08-15",
          feeMethod: "REMAINING_SESSIONS",
          previewToken: preview.previewToken,
        },
        null,
      );
      expect(created.enrollment.status).toBe("ACTIVE");
      expect(created.enrollment.feeMethod).toBe("REMAINING_SESSIONS");
      expect((created as unknown as Record<string, unknown>).obligation).toBeUndefined();
    });

    it("returns the PRD unavailable message when the GroupMonth has zero billable sessions", async () => {
      const gm = seedGroupMonth({ joinFeePolicy: "REMAINING" });
      const student = await seedStudent();
      await expect(
        service.previewEnrollment(owner, ownerContext, gm.id, { studentId: student.id, joinDate: "2026-08-01" }),
      ).rejects.toMatchObject({
        response: { details: { fieldErrors: { feeMethod: [expect.stringContaining("لا توجد حصص قابلة للحساب")] } } },
      });
    });
  });

  describe("INT-08 reactivation", () => {
    it("a student returning to the same GroupMonth reactivates the SAME row across multiple join/withdraw/rejoin cycles", async () => {
      const gm = seedGroupMonth({ joinFeePolicy: "FULL" });
      const student = await seedStudent();

      const preview1 = await service.previewEnrollment(owner, ownerContext, gm.id, {
        studentId: student.id,
        joinDate: "2026-08-01",
      });
      const first = await service.createEnrollment(
        owner,
        ownerContext,
        gm.id,
        { studentId: student.id, joinDate: "2026-08-01", feeMethod: "FULL_MONTH", previewToken: preview1.previewToken },
        null,
      );

      await service.withdrawEnrollment(owner, ownerContext, first.enrollment.id, {}, null);

      const preview2 = await service.previewEnrollment(owner, ownerContext, gm.id, {
        studentId: student.id,
        joinDate: "2026-08-10",
      });
      const second = await service.createEnrollment(
        owner,
        ownerContext,
        gm.id,
        { studentId: student.id, joinDate: "2026-08-10", feeMethod: "FULL_MONTH", previewToken: preview2.previewToken },
        null,
      );

      expect(second.enrollment.id).toBe(first.enrollment.id); // SAME row, reactivated
      expect(second.enrollment.status).toBe("ACTIVE");
      expect(repo.enrollmentsById.size).toBe(1); // only one row ever exists for this pair
    });
  });

  describe("withdraw", () => {
    it("preserves history — the row remains queryable, never deleted", async () => {
      const gm = seedGroupMonth({ joinFeePolicy: "FULL" });
      const student = await seedStudent();
      const preview = await service.previewEnrollment(owner, ownerContext, gm.id, {
        studentId: student.id,
        joinDate: "2026-08-01",
      });
      const created = await service.createEnrollment(
        owner,
        ownerContext,
        gm.id,
        { studentId: student.id, joinDate: "2026-08-01", feeMethod: "FULL_MONTH", previewToken: preview.previewToken },
        null,
      );

      const withdrawn = await service.withdrawEnrollment(
        owner,
        ownerContext,
        created.enrollment.id,
        { reason: "moved" },
        null,
      );
      expect(withdrawn.enrollment.status).toBe("WITHDRAWN");
      const row = await repo.findEnrollmentById(created.enrollment.id);
      expect(row).toBeDefined();
      expect(row!.endReason).toBe("moved");
    });
  });

  describe("transfer", () => {
    it("preserves student_id across a transfer and ends the source while creating exactly one target enrollment", async () => {
      const sourceGm = seedGroupMonth({ joinFeePolicy: "FULL" });
      const targetGm = seedGroupMonth({ joinFeePolicy: "FULL" });
      const student = await seedStudent();

      const preview = await service.previewEnrollment(owner, ownerContext, sourceGm.id, {
        studentId: student.id,
        joinDate: "2026-08-01",
      });
      const created = await service.createEnrollment(
        owner,
        ownerContext,
        sourceGm.id,
        { studentId: student.id, joinDate: "2026-08-01", feeMethod: "FULL_MONTH", previewToken: preview.previewToken },
        null,
      );

      const transferPreview = await service.transferPreview(owner, ownerContext, created.enrollment.id, {
        targetGroupMonthId: targetGm.id,
        feeMethod: "FULL_MONTH",
      });
      const result = await service.transfer(
        owner,
        ownerContext,
        created.enrollment.id,
        { previewToken: transferPreview.previewToken, feeMethod: "FULL_MONTH" },
        null,
      );

      expect(result.source.status).toBe("TRANSFERRED");
      expect(result.target.status).toBe("ACTIVE");
      expect(result.source.studentId).toBe(student.id);
      expect(result.target.studentId).toBe(student.id); // Student identity unchanged
      expect(result.target.groupMonthId).toBe(targetGm.id);

      const allForStudent = [...repo.enrollmentsById.values()].filter((e) => e.studentId === student.id);
      expect(allForStudent).toHaveLength(2); // source (ended) + exactly one new target
    });

    describe("Product Decision — Transfer Fee Method", () => {
      it("feeMethod is required — a missing value is a validation error, never a silent FULL_MONTH default", () => {
        // Enforced by the zod contract schema itself (transferFeeMethodSchema
        // is required, not .optional()) — the application layer never sees
        // an undefined feeMethod to begin with. Documents the contract-level
        // guarantee alongside the runtime behavior tests below.
        expect(() =>
          enrollmentTransferPreviewRequestSchema.parse({ targetGroupMonthId: "00000000-0000-0000-0000-000000000000" }),
        ).toThrow();
        expect(() => enrollmentTransferRequestSchema.parse({ previewToken: "x" })).toThrow();
      });

      it("FULL_MONTH transfer charges the target GroupMonth's base fee in full, regardless of join date", async () => {
        const sourceGm = seedGroupMonth({ joinFeePolicy: "FULL" });
        const targetGm = seedGroupMonth({ joinFeePolicy: "ASK_EVERY_TIME", baseFeeMinor: 75000 });
        const student = await seedStudent();
        const sourcePreview = await service.previewEnrollment(owner, ownerContext, sourceGm.id, {
          studentId: student.id,
          joinDate: "2026-08-01",
        });
        const created = await service.createEnrollment(
          owner,
          ownerContext,
          sourceGm.id,
          { studentId: student.id, joinDate: "2026-08-01", feeMethod: "FULL_MONTH", previewToken: sourcePreview.previewToken },
          null,
        );

        const preview = await service.transferPreview(owner, ownerContext, created.enrollment.id, {
          targetGroupMonthId: targetGm.id,
          feeMethod: "FULL_MONTH",
        });
        expect(preview.calculatedDueMinor).toBe(75000);
        expect(preview.eligibleSessions).toBeNull();
        expect(preview.totalBillableSessions).toBeNull();

        const result = await service.transfer(
          owner,
          ownerContext,
          created.enrollment.id,
          { previewToken: preview.previewToken, feeMethod: "FULL_MONTH" },
          null,
        );
        expect(result.target.feeMethod).toBe("FULL_MONTH");
      });

      it("REMAINING_SESSIONS transfer runs the same Proration Engine as a normal Enrollment", async () => {
        const sourceGm = seedGroupMonth({ joinFeePolicy: "FULL" });
        const targetGm = seedGroupMonth({ joinFeePolicy: "ASK_EVERY_TIME", baseFeeMinor: 60000 });
        for (let i = 0; i < 5; i += 1) {
          repo.seedSession({
            workspaceId: WORKSPACE_A,
            groupMonthId: targetGm.id,
            createdByUserId: owner.id,
            scheduledAt: new Date(Date.UTC(2026, 7, 1 + i, 8, 0, 0)),
          });
        }
        for (let i = 0; i < 3; i += 1) {
          repo.seedSession({
            workspaceId: WORKSPACE_A,
            groupMonthId: targetGm.id,
            createdByUserId: owner.id,
            scheduledAt: new Date(Date.UTC(2026, 7, 15 + i, 8, 0, 0)),
          });
        }
        const student = await seedStudent();
        const sourcePreview = await service.previewEnrollment(owner, ownerContext, sourceGm.id, {
          studentId: student.id,
          joinDate: "2026-08-01",
        });
        const created = await service.createEnrollment(
          owner,
          ownerContext,
          sourceGm.id,
          { studentId: student.id, joinDate: "2026-08-01", feeMethod: "FULL_MONTH", previewToken: sourcePreview.previewToken },
          null,
        );

        const preview = await service.transferPreview(owner, ownerContext, created.enrollment.id, {
          targetGroupMonthId: targetGm.id,
          joinDate: "2026-08-15",
          feeMethod: "REMAINING_SESSIONS",
        });
        // Same exact PRD AC-07 worked example as regular Enrollment (60000 * 3 / 8).
        expect(preview.calculatedDueMinor).toBe(22500);
        expect(preview.eligibleSessions).toBe(3);
        expect(preview.totalBillableSessions).toBe(8);

        const result = await service.transfer(
          owner,
          ownerContext,
          created.enrollment.id,
          { previewToken: preview.previewToken, feeMethod: "REMAINING_SESSIONS" },
          null,
        );
        expect(result.target.feeMethod).toBe("REMAINING_SESSIONS");
      });

      it("REMAINING_SESSIONS transfer into a GroupMonth with zero billable sessions is rejected — same rule as a normal Enrollment", async () => {
        const sourceGm = seedGroupMonth({ joinFeePolicy: "FULL" });
        const targetGm = seedGroupMonth({ joinFeePolicy: "ASK_EVERY_TIME" }); // no sessions seeded
        const student = await seedStudent();
        const sourcePreview = await service.previewEnrollment(owner, ownerContext, sourceGm.id, {
          studentId: student.id,
          joinDate: "2026-08-01",
        });
        const created = await service.createEnrollment(
          owner,
          ownerContext,
          sourceGm.id,
          { studentId: student.id, joinDate: "2026-08-01", feeMethod: "FULL_MONTH", previewToken: sourcePreview.previewToken },
          null,
        );

        await expect(
          service.transferPreview(owner, ownerContext, created.enrollment.id, {
            targetGroupMonthId: targetGm.id,
            feeMethod: "REMAINING_SESSIONS",
          }),
        ).rejects.toMatchObject({
          response: { details: { fieldErrors: { feeMethod: [expect.stringContaining("لا توجد حصص قابلة للحساب")] } } },
        });
      });
    });
  });

  describe("cross-workspace / scope safety", () => {
    it("404s (safe no-leak) when the group_month belongs to a different workspace", async () => {
      const foreignGroup = repo.seedGroup({ workspaceId: "workspace-b", name: "Foreign" });
      const foreignGm = repo.seedGroupMonth({ workspaceId: "workspace-b", groupId: foreignGroup.id });
      const student = await seedStudent();
      await expect(
        service.previewEnrollment(owner, ownerContext, foreignGm.id, { studentId: student.id, joinDate: "2026-08-01" }),
      ).rejects.toBeInstanceOf(ResourceNotFoundException);
    });

    it("a SELECTED_GROUPS-scoped caller outside the group's scope is rejected", async () => {
      const gm = seedGroupMonth({ joinFeePolicy: "FULL" });
      const student = await seedStudent();

      const scopedUser: VerifiedSupabaseToken = { id: "u-scoped", email: "scoped@example.com" };
      const scopedMembership = teamRepo.seedMembership({
        workspaceId: WORKSPACE_A,
        userId: scopedUser.id,
        roleLabel: "ASSISTANT",
      });
      // No grant at all for students.edit -> zero effective permissions for this user.
      const scopedContext: WorkspaceContext = { workspaceId: WORKSPACE_A, membership: scopedMembership };

      await expect(
        service.previewEnrollment(scopedUser, scopedContext, gm.id, { studentId: student.id, joinDate: "2026-08-01" }),
      ).rejects.toBeInstanceOf(ResourceNotFoundException);
    });
  });
});
