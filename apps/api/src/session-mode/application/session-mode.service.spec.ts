import { randomUUID } from "node:crypto";
import {
  BatchValidationFailedException,
  ResourceNotFoundException,
  SessionAlreadyCompletedException,
  SessionRecordsMissingException,
  VersionConflictException,
} from "../../common/exceptions/api.exception";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import type { WorkspaceContext } from "../../team/api/guards/permission.guard";
import { PermissionResolverService } from "../../team/application/permission-resolver.service";
import { InMemoryTeamRepository } from "../../team/application/__fixtures__/in-memory-team.repository";
import { InMemoryStudentsRepository } from "../../students/application/__fixtures__/in-memory-students.repository";
import { InMemorySessionModeRepository } from "./__fixtures__/in-memory-session-mode.repository";
import { SessionModeService } from "./session-mode.service";

const WORKSPACE_A = "workspace-a";

describe("SessionModeService", () => {
  let shared: InMemoryStudentsRepository;
  let repo: InMemorySessionModeRepository;
  let teamRepo: InMemoryTeamRepository;
  let resolver: PermissionResolverService;
  let service: SessionModeService;

  let owner: VerifiedSupabaseToken;
  let ownerContext: WorkspaceContext;

  let groupA: ReturnType<InMemoryStudentsRepository["seedGroup"]>;
  let groupMonthA: ReturnType<InMemoryStudentsRepository["seedGroupMonth"]>;

  beforeEach(() => {
    shared = new InMemoryStudentsRepository();
    repo = new InMemorySessionModeRepository(shared);
    teamRepo = new InMemoryTeamRepository();
    resolver = new PermissionResolverService(teamRepo);
    service = new SessionModeService(repo, resolver);

    owner = { id: "u-owner", email: "owner@example.com" };
    const ownerMembership = teamRepo.seedMembership({ workspaceId: WORKSPACE_A, userId: owner.id, roleLabel: "OWNER" });
    ownerContext = { workspaceId: WORKSPACE_A, membership: ownerMembership };

    groupA = shared.seedGroup({ workspaceId: WORKSPACE_A, name: "Group A" });
    groupMonthA = shared.seedGroupMonth({ workspaceId: WORKSPACE_A, groupId: groupA.id });
  });

  function seedSession(overrides: Partial<Parameters<InMemoryStudentsRepository["seedSession"]>[0]> = {}) {
    return shared.seedSession({
      workspaceId: WORKSPACE_A,
      groupMonthId: groupMonthA.id,
      createdByUserId: owner.id,
      scheduledAt: new Date("2026-08-10T08:00:00Z"),
      status: "SCHEDULED",
      origin: "GENERATED",
      ...overrides,
    });
  }

  async function seedStudentWithEnrollment(name: string, joinDate: string, endedAt: Date | null = null) {
    const student = shared.seedStudent({ workspaceId: WORKSPACE_A, studentCode: `AP-${randomUUID().slice(0, 6)}`, name });
    const { enrollment } = await shared.createOrReactivateEnrollmentTransaction({
      workspaceId: WORKSPACE_A,
      studentId: student.id,
      groupMonthId: groupMonthA.id,
      joinDate,
      status: "ACTIVE",
      feeMethod: "FULL_MONTH",
    });
    if (endedAt) {
      shared.enrollmentsById.set(enrollment.id, { ...enrollment, endedAt, status: "WITHDRAWN" });
    }
    return { student, enrollment };
  }

  describe("lifecycle", () => {
    it("SCHEDULED -> IN_PROGRESS via start, version bumps", async () => {
      const session = seedSession();
      const result = await service.startSession(owner, ownerContext, session.id, { version: session.version }, null);
      expect(result.session.status).toBe("IN_PROGRESS");
      expect(result.session.version).toBe(session.version + 1);
    });
  });

  describe("roster derivation", () => {
    it("a student who joined AFTER the session date does not appear in the roster", async () => {
      const session = seedSession({ scheduledAt: new Date("2026-08-10T08:00:00Z") });
      await seedStudentWithEnrollment("لاحق", "2026-08-15");
      const roster = await service.getRoster(owner, ownerContext, session.id);
      expect(roster.students).toHaveLength(0);
    });

    it("a student who withdrew BEFORE the session date does not appear in the roster", async () => {
      const session = seedSession({ scheduledAt: new Date("2026-08-10T08:00:00Z") });
      await seedStudentWithEnrollment("منسحب", "2026-08-01", new Date("2026-08-05T00:00:00Z"));
      const roster = await service.getRoster(owner, ownerContext, session.id);
      expect(roster.students).toHaveLength(0);
    });

    it("an eligible student appears exactly once", async () => {
      const session = seedSession();
      await seedStudentWithEnrollment("مؤهل", "2026-08-01");
      const roster = await service.getRoster(owner, ownerContext, session.id);
      expect(roster.students).toHaveLength(1);
    });
  });

  describe("cross-group session_record guard (application layer)", () => {
    it("rejects a batch referencing an enrollment from a DIFFERENT GroupMonth", async () => {
      const session = seedSession();
      const { session: started } = await service.startSession(owner, ownerContext, session.id, { version: session.version }, null);

      const otherGroup = shared.seedGroup({ workspaceId: WORKSPACE_A, name: "Other" });
      const otherGroupMonth = shared.seedGroupMonth({ workspaceId: WORKSPACE_A, groupId: otherGroup.id });
      const foreignStudent = shared.seedStudent({ workspaceId: WORKSPACE_A, studentCode: "AP-FOREIGN", name: "خارجي" });
      const { enrollment: foreignEnrollment } = await shared.createOrReactivateEnrollmentTransaction({
        workspaceId: WORKSPACE_A,
        studentId: foreignStudent.id,
        groupMonthId: otherGroupMonth.id,
        joinDate: "2026-08-01",
        status: "ACTIVE",
        feeMethod: "FULL_MONTH",
      });

      await expect(
        service.putAttendance(owner, ownerContext, session.id, {
          sessionVersion: started.version,
          records: [{ enrollmentId: foreignEnrollment.id, status: "PRESENT" }],
        }),
      ).rejects.toBeInstanceOf(BatchValidationFailedException);
    });
  });

  describe("absence does not block homework", () => {
    it("ABSENT attendance and DONE homework persist independently for the same student", async () => {
      const session = seedSession();
      const { enrollment } = await seedStudentWithEnrollment("طالب", "2026-08-01");
      const { session: started } = await service.startSession(owner, ownerContext, session.id, { version: session.version }, null);

      const afterAttendance = await service.putAttendance(owner, ownerContext, session.id, {
        sessionVersion: started.version,
        records: [{ enrollmentId: enrollment.id, status: "ABSENT" }],
      });
      const afterHomework = await service.putHomework(owner, ownerContext, session.id, {
        sessionVersion: afterAttendance.sessionVersion,
        records: [{ enrollmentId: enrollment.id, status: "DONE" }],
      });
      expect(afterHomework.summary.done).toBe(1);

      const roster = await service.getRoster(owner, ownerContext, session.id);
      const row = roster.students.find((s) => s.enrollmentId === enrollment.id)!;
      expect(row.record.attendance).toBe("ABSENT");
      expect(row.record.homework).toBe("DONE");
    });
  });

  describe("exam absent vs numeric zero", () => {
    it("ABSENT_FROM_EXAM never stores a numeric zero score", async () => {
      const session = seedSession();
      const { enrollment } = await seedStudentWithEnrollment("طالب", "2026-08-01");
      const { session: started } = await service.startSession(owner, ownerContext, session.id, { version: session.version }, null);

      await service.putExamDefinition(owner, ownerContext, session.id, { hasExam: true, maxScore: 20 });
      const afterScores = await service.putExamScores(owner, ownerContext, session.id, {
        sessionVersion: started.version,
        records: [{ enrollmentId: enrollment.id, status: "ABSENT_FROM_EXAM" }],
      });
      expect(afterScores.updated).toBe(1);

      const roster = await service.getRoster(owner, ownerContext, session.id);
      const row = roster.students.find((s) => s.enrollmentId === enrollment.id)!;
      expect(row.record.examStatus).toBe("ABSENT_FROM_EXAM");
      expect(row.record.examScore).toBeNull(); // never 0
    });
  });

  describe("complete — missing records / canComplete gate", () => {
    it("fails with SESSION_RECORDS_MISSING when required records are missing (flag=false default)", async () => {
      const session = seedSession();
      await seedStudentWithEnrollment("طالب", "2026-08-01");
      await service.startSession(owner, ownerContext, session.id, { version: session.version }, null);

      await expect(
        service.completeSession(owner, ownerContext, session.id, "key-1", { version: session.version + 1 }, null),
      ).rejects.toBeInstanceOf(SessionRecordsMissingException);
    });

    it("succeeds only once review reports canComplete=true (all required records filled)", async () => {
      const session = seedSession();
      const { enrollment } = await seedStudentWithEnrollment("طالب", "2026-08-01");
      const { session: started } = await service.startSession(owner, ownerContext, session.id, { version: session.version }, null);

      const afterAttendance = await service.putAttendance(owner, ownerContext, session.id, {
        sessionVersion: started.version,
        records: [{ enrollmentId: enrollment.id, status: "PRESENT" }],
      });
      const afterHomework = await service.putHomework(owner, ownerContext, session.id, {
        sessionVersion: afterAttendance.sessionVersion,
        records: [{ enrollmentId: enrollment.id, status: "NO_HOMEWORK" }],
      });

      const review = await service.getReview(owner, ownerContext, session.id);
      expect(review.canComplete).toBe(true);
      expect(review.missingRecords).toHaveLength(0);

      const completed = await service.completeSession(
        owner,
        ownerContext,
        session.id,
        "key-2",
        { version: afterHomework.sessionVersion },
        null,
      );
      expect(completed.session.status).toBe("COMPLETED");
    });
  });

  describe("complete — idempotency", () => {
    it("a second call with the SAME Idempotency-Key returns the cached response and does not re-run effects", async () => {
      const session = seedSession();
      const { enrollment } = await seedStudentWithEnrollment("طالب", "2026-08-01");
      const { session: started } = await service.startSession(owner, ownerContext, session.id, { version: session.version }, null);
      const afterAttendance = await service.putAttendance(owner, ownerContext, session.id, {
        sessionVersion: started.version,
        records: [{ enrollmentId: enrollment.id, status: "PRESENT" }],
      });
      const afterHomework = await service.putHomework(owner, ownerContext, session.id, {
        sessionVersion: afterAttendance.sessionVersion,
        records: [{ enrollmentId: enrollment.id, status: "NO_HOMEWORK" }],
      });

      const key = "idem-key-complete";
      const first = await service.completeSession(owner, ownerContext, session.id, key, { version: afterHomework.sessionVersion }, null);
      const auditCountAfterFirst = repo.auditEvents.length;

      const second = await service.completeSession(owner, ownerContext, session.id, key, { version: afterHomework.sessionVersion }, null);
      expect(second).toEqual(first);
      expect(repo.auditEvents.length).toBe(auditCountAfterFirst); // no re-run

      // A genuinely-new key against an already-COMPLETED session is rejected.
      await expect(
        service.completeSession(owner, ownerContext, session.id, "another-key", { version: afterHomework.sessionVersion }, null),
      ).rejects.toBeInstanceOf(SessionAlreadyCompletedException);
    });
  });

  describe("optimistic concurrency", () => {
    it("a stale sessionVersion on attendance batch is VERSION_CONFLICT", async () => {
      const session = seedSession();
      const { enrollment } = await seedStudentWithEnrollment("طالب", "2026-08-01");
      await service.startSession(owner, ownerContext, session.id, { version: session.version }, null);

      await expect(
        service.putAttendance(owner, ownerContext, session.id, {
          sessionVersion: session.version, // stale — start() already bumped it
          records: [{ enrollmentId: enrollment.id, status: "PRESENT" }],
        }),
      ).rejects.toBeInstanceOf(VersionConflictException);
    });

    it("a stale version on complete is VERSION_CONFLICT", async () => {
      const session = seedSession();
      const { enrollment } = await seedStudentWithEnrollment("طالب", "2026-08-01");
      const { session: started } = await service.startSession(owner, ownerContext, session.id, { version: session.version }, null);
      await service.putAttendance(owner, ownerContext, session.id, {
        sessionVersion: started.version,
        records: [{ enrollmentId: enrollment.id, status: "PRESENT" }],
      });
      await service.putHomework(owner, ownerContext, session.id, {
        sessionVersion: started.version + 1,
        records: [{ enrollmentId: enrollment.id, status: "NO_HOMEWORK" }],
      });

      await expect(
        service.completeSession(owner, ownerContext, session.id, "stale-key", { version: started.version }, null), // stale
      ).rejects.toBeInstanceOf(VersionConflictException);
    });
  });

  describe("Group Scope enforcement", () => {
    it("a member outside the session's Group Scope cannot see or edit it", async () => {
      const session = seedSession();
      await seedStudentWithEnrollment("طالب", "2026-08-01");

      const groupB = shared.seedGroup({ workspaceId: WORKSPACE_A, name: "Group B" });
      const assistantB: VerifiedSupabaseToken = { id: "u-assistant-b", email: "assistant-b@example.com" };
      const membershipB = teamRepo.seedMembership({ workspaceId: WORKSPACE_A, userId: assistantB.id, roleLabel: "ASSISTANT" });
      await teamRepo.replaceMembershipGrants({
        workspaceId: WORKSPACE_A,
        membershipId: membershipB.id,
        createdByUserId: owner.id,
        desiredGrants: [
          { permissionKey: "attendance.write", scopeType: "SELECTED_GROUPS", groupIds: [groupB.id] },
          { permissionKey: "students.view_basic", scopeType: "SELECTED_GROUPS", groupIds: [groupB.id] },
          { permissionKey: "groups.view", scopeType: "SELECTED_GROUPS", groupIds: [groupB.id] },
        ],
      });
      const contextB: WorkspaceContext = { workspaceId: WORKSPACE_A, membership: membershipB };

      await expect(service.getRoster(assistantB, contextB, session.id)).rejects.toBeInstanceOf(ResourceNotFoundException);
      await expect(
        service.startSession(assistantB, contextB, session.id, { version: session.version }, null),
      ).rejects.toBeInstanceOf(ResourceNotFoundException);
      await expect(service.getReview(assistantB, contextB, session.id)).rejects.toBeInstanceOf(ResourceNotFoundException);
      await expect(
        service.completeSession(assistantB, contextB, session.id, "key", { version: session.version }, null),
      ).rejects.toBeInstanceOf(ResourceNotFoundException);
    });
  });

  describe("history after completion", () => {
    it("session_records/roster remain readable after the Session is COMPLETED — never hidden/deleted", async () => {
      const session = seedSession();
      const { enrollment } = await seedStudentWithEnrollment("طالب", "2026-08-01");
      const { session: started } = await service.startSession(owner, ownerContext, session.id, { version: session.version }, null);
      const afterAttendance = await service.putAttendance(owner, ownerContext, session.id, {
        sessionVersion: started.version,
        records: [{ enrollmentId: enrollment.id, status: "PRESENT" }],
      });
      const afterHomework = await service.putHomework(owner, ownerContext, session.id, {
        sessionVersion: afterAttendance.sessionVersion,
        records: [{ enrollmentId: enrollment.id, status: "NO_HOMEWORK" }],
      });
      await service.completeSession(owner, ownerContext, session.id, "hist-key", { version: afterHomework.sessionVersion }, null);

      const roster = await service.getRoster(owner, ownerContext, session.id);
      expect(roster.session.status).toBe("COMPLETED");
      const row = roster.students.find((s) => s.enrollmentId === enrollment.id)!;
      expect(row.record.attendance).toBe("PRESENT");
      expect(row.record.homework).toBe("NO_HOMEWORK");
    });
  });
});
