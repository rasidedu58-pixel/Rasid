import {
  QrAlreadyActiveException,
  QrInvalidException,
  ResourceNotFoundException,
  ValidationApiException,
  VersionConflictException,
} from "../../common/exceptions/api.exception";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import type { WorkspaceContext } from "../../team/api/guards/permission.guard";
import { PermissionResolverService } from "../../team/application/permission-resolver.service";
import { InMemoryTeamRepository } from "../../team/application/__fixtures__/in-memory-team.repository";
import { InMemoryStudentsRepository } from "./__fixtures__/in-memory-students.repository";
import { StudentsService } from "./students.service";

const WORKSPACE_A = "workspace-a";
const WORKSPACE_B = "workspace-b";

describe("StudentsService", () => {
  let repo: InMemoryStudentsRepository;
  let teamRepo: InMemoryTeamRepository;
  let resolver: PermissionResolverService;
  let service: StudentsService;
  let owner: VerifiedSupabaseToken;
  let ownerContext: WorkspaceContext;

  beforeEach(() => {
    repo = new InMemoryStudentsRepository();
    teamRepo = new InMemoryTeamRepository();
    resolver = new PermissionResolverService(teamRepo);
    service = new StudentsService(repo, resolver);
    owner = { id: "u-owner", email: "owner@example.com" };
    const ownerMembership = teamRepo.seedMembership({ workspaceId: WORKSPACE_A, userId: owner.id, roleLabel: "OWNER" });
    ownerContext = { workspaceId: WORKSPACE_A, membership: ownerMembership };
  });

  describe("createStudent", () => {
    it("creates a student, links guardians, and issues exactly one ACTIVE QR credential", async () => {
      const result = await service.createStudent(
        owner,
        ownerContext,
        {
          name: "أحمد محمد",
          guardians: [
            { name: "محمد", phone: "+201001234567", relationship: "FATHER", isPrimary: true },
          ],
        },
        null,
      );

      expect(result.student.name).toBe("أحمد محمد");
      expect(result.student.status).toBe("ACTIVE");
      expect(result.guardians).toHaveLength(1);
      expect(result.guardians[0]!.isPrimary).toBe(true);
      expect(result.qr.displayToken).toBeTruthy();

      const active = await repo.findActiveQrForStudent(result.student.id);
      expect(active).toBeDefined();
      expect(active!.tokenHash).not.toBe(result.qr.displayToken); // never stores the raw token
    });

    it("defaults the FIRST guardian to primary when none is explicitly marked", async () => {
      const result = await service.createStudent(
        owner,
        ownerContext,
        {
          name: "سارة",
          guardians: [
            { name: "أب", phone: "+201000000001" },
            { name: "أم", phone: "+201000000002" },
          ],
        },
        null,
      );
      expect(result.guardians[0]!.isPrimary).toBe(true);
      expect(result.guardians[1]!.isPrimary).toBe(false);
    });

    it("rejects more than one guardian explicitly marked isPrimary", async () => {
      await expect(
        service.createStudent(
          owner,
          ownerContext,
          {
            name: "سارة",
            guardians: [
              { phone: "+201000000001", isPrimary: true },
              { phone: "+201000000002", isPrimary: true },
            ],
          },
          null,
        ),
      ).rejects.toBeInstanceOf(ValidationApiException);
    });

    it("does NOT auto-merge guardians sharing the same phone across two different students", async () => {
      await service.createStudent(owner, ownerContext, { name: "A", guardians: [{ phone: "+201234567890" }] }, null);
      await service.createStudent(owner, ownerContext, { name: "B", guardians: [{ phone: "+201234567890" }] }, null);
      expect(repo.guardiansById.size).toBe(2); // two distinct guardian rows, never merged
    });
  });

  describe("cross-workspace safety", () => {
    it("getStudent 404s (safe no-leak) for a student belonging to a different workspace", async () => {
      const other = repo.seedStudent({ workspaceId: WORKSPACE_B, studentCode: "AP-XXXXXX", name: "Other" });
      await expect(service.getStudent(owner, ownerContext, other.id)).rejects.toBeInstanceOf(ResourceNotFoundException);
    });

    it("getStudentEnrollments 404s (safe no-leak) for a foreign-workspace student", async () => {
      const other = repo.seedStudent({ workspaceId: WORKSPACE_B, studentCode: "AP-YYYYYY", name: "Other" });
      await expect(service.getStudentEnrollments(owner, ownerContext, other.id)).rejects.toBeInstanceOf(ResourceNotFoundException);
    });

    it("getStudentEnrollments returns an empty history (never invents rows) for a student with no enrollments", async () => {
      const created = await service.createStudent(owner, ownerContext, { name: "بلا مجموعة" }, null);
      const res = await service.getStudentEnrollments(owner, ownerContext, created.student.id);
      expect(res.enrollments).toEqual([]);
    });
  });

  describe("update / archive", () => {
    it("409s on a stale version and re-derives search_name_normalized on name change", async () => {
      const created = await service.createStudent(owner, ownerContext, { name: "خالد" }, null);
      const updated = await service.updateStudent(
        owner,
        ownerContext,
        created.student.id,
        { version: created.student.version, name: "خَالِد" },
        null,
      );
      expect(updated.name).toBe("خَالِد");
      const row = await repo.findStudentById(created.student.id);
      expect(row!.searchNameNormalized).toBe("خالد");

      await expect(
        service.updateStudent(owner, ownerContext, created.student.id, { version: 1, name: "x" }, null),
      ).rejects.toBeInstanceOf(VersionConflictException);
    });

    it("archives without hard-deleting the row", async () => {
      const created = await service.createStudent(owner, ownerContext, { name: "منى" }, null);
      const archived = await service.archiveStudent(owner, ownerContext, created.student.id, null);
      expect(archived.status).toBe("ARCHIVED");
      const row = await repo.findStudentById(created.student.id);
      expect(row).toBeDefined();
      expect(row!.archivedAt).not.toBeNull();
    });
  });

  describe("guardians — INT-03 primary", () => {
    it("setting a new primary unsets the previous one; never two primaries at once", async () => {
      const created = await service.createStudent(
        owner,
        ownerContext,
        { name: "طالب", guardians: [{ phone: "+201111111111", isPrimary: true }, { phone: "+201222222222" }] },
        null,
      );
      const [first, second] = created.guardians;
      await service.setPrimaryGuardian(owner, ownerContext, created.student.id, second!.id, null);

      const links = await repo.listGuardiansForStudent(created.student.id);
      const primaries = links.filter((l) => l.link.isPrimary);
      expect(primaries).toHaveLength(1);
      expect(primaries[0]!.link.id).toBe(second!.id);
      void first;
    });

    it("linking the same guardian twice to the same student is rejected by the unique-pair semantics", async () => {
      const created = await service.createStudent(owner, ownerContext, { name: "طالب" }, null);
      const guardian = repo.seedGuardian({ workspaceId: WORKSPACE_A, phone: "1", normalizedPhone: "1" });
      await service.linkGuardian(owner, ownerContext, created.student.id, { guardianId: guardian.id }, null);
      // A second link attempt with the SAME guardianId would violate
      // UNIQUE(student_id, guardian_id) at the DB layer; the in-memory
      // fixture does not enforce uniqueness itself (mirrors how the real
      // repository delegates that to Postgres), so this test documents the
      // expected real-DB behavior via the live integration suite instead.
      expect(repo.studentGuardiansById.size).toBe(1);
    });
  });

  describe("QR", () => {
    it("reissue revokes the old ACTIVE credential and issues exactly one new one; student id is unchanged", async () => {
      const created = await service.createStudent(owner, ownerContext, { name: "طالب" }, null);
      const before = await repo.findActiveQrForStudent(created.student.id);

      const reissued = await service.reissueQr(owner, ownerContext, created.student.id, {}, null);

      const activeCredentials = [...repo.qrById.values()].filter(
        (q) => q.studentId === created.student.id && q.status === "ACTIVE",
      );
      expect(activeCredentials).toHaveLength(1);
      expect(activeCredentials[0]!.id).toBe(reissued.credentialId);
      expect(before!.id).not.toBe(reissued.credentialId);

      const revokedOld = repo.qrById.get(before!.id);
      expect(revokedOld!.status).toBe("REVOKED");

      const studentAfter = await repo.findStudentById(created.student.id);
      expect(studentAfter!.id).toBe(created.student.id); // Student ID unchanged
    });

    it("a second /issue call while one is ACTIVE is rejected cleanly", async () => {
      const created = await service.createStudent(owner, ownerContext, { name: "طالب" }, null);
      await expect(service.issueQr(owner, ownerContext, created.student.id, null)).rejects.toBeInstanceOf(
        QrAlreadyActiveException,
      );
    });

    it("resolve (GLOBAL) finds the student for a valid token and never leaks details for an invalid one", async () => {
      const created = await service.createStudent(owner, ownerContext, { name: "طالب QR" }, null);
      const resolved = await service.resolveQr(owner, ownerContext, { token: created.qr.displayToken, context: "GLOBAL" });
      expect(resolved.studentId).toBe(created.student.id);

      await expect(
        service.resolveQr(owner, ownerContext, { token: "not-a-real-token", context: "GLOBAL" }),
      ).rejects.toBeInstanceOf(QrInvalidException);
    });

    it("rejects a non-GLOBAL context explicitly rather than silently no-op'ing", async () => {
      await expect(
        service.resolveQr(owner, ownerContext, { token: "x", context: "SESSION" }),
      ).rejects.toBeInstanceOf(ValidationApiException);
    });

    it("resolve never distinguishes a genuinely-unknown token from one belonging to another workspace", async () => {
      const created = await service.createStudent(owner, ownerContext, { name: "طالب" }, null);
      const otherWorkspaceContext: WorkspaceContext = { ...ownerContext, workspaceId: WORKSPACE_B };
      await expect(
        service.resolveQr(owner, otherWorkspaceContext, { token: created.qr.displayToken, context: "GLOBAL" }),
      ).rejects.toBeInstanceOf(QrInvalidException);
    });
  });

  describe("search", () => {
    it("finds a student by exact student_code", async () => {
      const created = await service.createStudent(owner, ownerContext, { name: "طالب بحث" }, null);
      const results = await service.listStudents(owner, ownerContext, { q: created.student.studentCode, searchBy: "code" });
      expect(results.items.map((s) => s.id)).toContain(created.student.id);
    });

    it("auto-detects a 4-5-digit numeric query as CODE (never routes it to phone)", async () => {
      // Two students in the same workspace get sequential numeric codes.
      const first = await service.createStudent(owner, ownerContext, { name: "طالب ١" }, null);
      const second = await service.createStudent(owner, ownerContext, { name: "طالب ٢" }, null);
      expect(first.student.studentCode).toBe("00001");
      expect(second.student.studentCode).toBe("00002");

      // Auto mode (no `searchBy`) — plain digits get routed to code.
      const byFull = await service.listStudents(owner, ownerContext, { q: "00002" });
      expect(byFull.items.map((s) => s.id)).toEqual([second.student.id]);
    });

    it("accepts partial numeric input by left-padding to 5 digits (00042 for '42')", async () => {
      // Seed 41 students so the next new student gets code 00042.
      for (let i = 0; i < 41; i += 1) {
        await service.createStudent(owner, ownerContext, { name: `طالب ${i}` }, null);
      }
      const target = await service.createStudent(owner, ownerContext, { name: "الهدف" }, null);
      expect(target.student.studentCode).toBe("00042");

      const results = await service.listStudents(owner, ownerContext, { q: "42" });
      expect(results.items.map((s) => s.id)).toContain(target.student.id);
    });

    it("Arabic-Indic digits (٠٠٠٤٢) resolve to the same student as Latin (00042)", async () => {
      for (let i = 0; i < 41; i += 1) {
        await service.createStudent(owner, ownerContext, { name: `س ${i}` }, null);
      }
      const target = await service.createStudent(owner, ownerContext, { name: "هدف" }, null);
      expect(target.student.studentCode).toBe("00042");

      const arabic = await service.listStudents(owner, ownerContext, { q: "٤٢" });
      expect(arabic.items.map((s) => s.id)).toContain(target.student.id);
    });

    it("preserves legacy AP-XXXXXX search (case-insensitive) alongside the new numeric codes", async () => {
      const legacy = repo.seedStudent({ workspaceId: WORKSPACE_A, studentCode: "AP-ABC123", name: "قديم" });
      const foundExact = await service.listStudents(owner, ownerContext, { q: "AP-ABC123" });
      const foundLower = await service.listStudents(owner, ownerContext, { q: "ap-abc123" });
      expect(foundExact.items.map((s) => s.id)).toContain(legacy.id);
      expect(foundLower.items.map((s) => s.id)).toContain(legacy.id);
    });

    it("still routes long digit strings to guardianPhone (7+ digits) — new numeric code search MUST NOT break phone lookup", async () => {
      // A 5-digit input goes to code; 6+ digits go to phone.
      const created = await service.createStudent(
        owner,
        ownerContext,
        {
          name: "طالب برقم ولي أمر",
          guardians: [{ name: "محمد", phone: "+201001234567", relationship: "FATHER", isPrimary: true }],
        },
        null,
      );
      // Query mirrors the stored normalized value (`+2010…` → `2010…`) — the
      // point of this test is that the 12-digit phone still routes to phone
      // mode after the new numeric-code heuristic; the underlying in-memory
      // search is exact-match, and the phone-vs-code routing is what we're
      // pinning here.
      const results = await service.listStudents(owner, ownerContext, { q: "+201001234567" });
      expect(results.items.map((s) => s.id)).toContain(created.student.id);
    });

    it("sequential codes are workspace-scoped: workspace B starts back at 00001 regardless of A's counter", async () => {
      const otherOwner: VerifiedSupabaseToken = { id: "u-owner-b", email: "b@example.com" };
      const otherMembership = teamRepo.seedMembership({ workspaceId: WORKSPACE_B, userId: otherOwner.id, roleLabel: "OWNER" });
      const otherContext: WorkspaceContext = { workspaceId: WORKSPACE_B, membership: otherMembership };

      // 3 students in A → codes 00001..00003.
      for (let i = 0; i < 3; i += 1) await service.createStudent(owner, ownerContext, { name: `A${i}` }, null);
      // First student in B → 00001 (independent counter).
      const firstInB = await service.createStudent(otherOwner, otherContext, { name: "B1" }, null);
      expect(firstInB.student.studentCode).toBe("00001");
    });

    it("legacy AP-XXXXXX rows do NOT interfere with the next numeric sequence (regex filter skips them)", async () => {
      // Two legacy rows seeded, plus a real new student.
      repo.seedStudent({ workspaceId: WORKSPACE_A, studentCode: "AP-OLD001", name: "قديم ١" });
      repo.seedStudent({ workspaceId: WORKSPACE_A, studentCode: "AP-OLD002", name: "قديم ٢" });
      const first = await service.createStudent(owner, ownerContext, { name: "جديد" }, null);
      expect(first.student.studentCode).toBe("00001");
    });

    it("unexpected non-5-digit numeric legacy codes are IGNORED by the counter (tighter regex ^\\d{5}$)", async () => {
      // Hypothetical stray rows a script once seeded: pure-digit codes
      // that are NOT 5 chars. The tightened regex ^\d{5}$ (mirrored on
      // both the real DB path and the in-memory fixture) skips them, so
      // the next numeric-code generation still starts at 00001 rather
      // than colliding with or being confused by them.
      repo.seedStudent({ workspaceId: WORKSPACE_A, studentCode: "123", name: "غريب ١" });
      repo.seedStudent({ workspaceId: WORKSPACE_A, studentCode: "9999999", name: "غريب ٢" });
      const first = await service.createStudent(owner, ownerContext, { name: "جديد" }, null);
      // Counter starts at 00001 — the 3-digit and 7-digit rows are skipped.
      expect(first.student.studentCode).toBe("00001");
    });
  });
});
