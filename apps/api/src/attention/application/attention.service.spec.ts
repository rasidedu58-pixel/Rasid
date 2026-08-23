import { randomUUID } from "node:crypto";
import {
  AttentionCaseInvalidStateException,
  FollowupInvalidStateException,
  GuardianContactDisabledException,
  ResourceNotFoundException,
  VersionConflictException,
} from "../../common/exceptions/api.exception";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import type { WorkspaceContext } from "../../team/api/guards/permission.guard";
import { PermissionResolverService } from "../../team/application/permission-resolver.service";
import { InMemoryTeamRepository } from "../../team/application/__fixtures__/in-memory-team.repository";
import { InMemoryAttentionRepository } from "./__fixtures__/in-memory-attention.repository";
import { AttentionService } from "./attention.service";

const WORKSPACE_A = "workspace-a";
const WORKSPACE_B = "workspace-b";

describe("AttentionService", () => {
  let repo: InMemoryAttentionRepository;
  let teamRepo: InMemoryTeamRepository;
  let resolver: PermissionResolverService;
  let service: AttentionService;

  let owner: VerifiedSupabaseToken;
  let ownerContext: WorkspaceContext;

  beforeEach(() => {
    repo = new InMemoryAttentionRepository();
    teamRepo = new InMemoryTeamRepository();
    resolver = new PermissionResolverService(teamRepo);
    service = new AttentionService(repo, resolver);

    owner = { id: "u-owner", email: "owner@example.com" };
    const ownerMembership = teamRepo.seedMembership({ workspaceId: WORKSPACE_A, userId: owner.id, roleLabel: "OWNER" });
    ownerContext = { workspaceId: WORKSPACE_A, membership: ownerMembership };
  });

  async function seedAssistant(email: string, groupIds: string[], permissions: string[] = ["followup.read", "followup.write", "parent_contact"]) {
    const user: VerifiedSupabaseToken = { id: `u-${email}`, email };
    const membership = teamRepo.seedMembership({ workspaceId: WORKSPACE_A, userId: user.id, roleLabel: "ASSISTANT" });
    await teamRepo.replaceMembershipGrants({
      workspaceId: WORKSPACE_A,
      membershipId: membership.id,
      createdByUserId: owner.id,
      desiredGrants: permissions.map((permissionKey) => ({ permissionKey, scopeType: "SELECTED_GROUPS" as const, groupIds })),
    });
    return { user, context: { workspaceId: WORKSPACE_A, membership } };
  }

  // ---------------------------------------------------------------------
  // 1+2: case creation is rule-engine-only (not directly service-tested
  // here — see packages/database's rule-engine.test.ts for "no alert for a
  // single absence" / "opens a case once a rule threshold is met", and the
  // live integration suite for the real end-to-end trigger). At the
  // service layer we confirm the converse: an empty repository never
  // surfaces a case for any student.
  // ---------------------------------------------------------------------

  it("1: a student with no seeded case never appears in the list or detail endpoints", async () => {
    const list = await service.listAttentionCases(owner, ownerContext, {});
    expect(list.items).toHaveLength(0);
    await expect(service.getAttentionCase(owner, ownerContext, randomUUID())).rejects.toBeInstanceOf(ResourceNotFoundException);
  });

  it("2: a case with a qualifying reason is visible in both list and detail, with its real priority", async () => {
    const student = repo.seedStudent({ workspaceId: WORKSPACE_A, name: "Student A" });
    const group = repo.seedGroup({ workspaceId: WORKSPACE_A, name: "Group A" });
    const attentionCase = repo.seedCase({ workspaceId: WORKSPACE_A, studentId: student.id, priority: "MEDIUM" });
    repo.seedReason({ workspaceId: WORKSPACE_A, attentionCaseId: attentionCase.id, groupId: group.id, ruleKey: "absence.consecutive", severity: "MEDIUM" });

    const list = await service.listAttentionCases(owner, ownerContext, {});
    expect(list.items).toHaveLength(1);
    expect(list.items[0]!.priority).toBe("MEDIUM");

    const detail = await service.getAttentionCase(owner, ownerContext, attentionCase.id);
    expect(detail.reasons).toHaveLength(1);
    expect(detail.reasons[0]!.ruleKey).toBe("absence.consecutive");
  });

  it("6+multi-group: a Student with a unified Case containing Evidence from Group A AND Group B — Assistant A sees only A, Assistant B sees only B, Owner sees both", async () => {
    const student = repo.seedStudent({ workspaceId: WORKSPACE_A, name: "Multi-Group Student" });
    const groupA = repo.seedGroup({ workspaceId: WORKSPACE_A, name: "Group A" });
    const groupB = repo.seedGroup({ workspaceId: WORKSPACE_A, name: "Group B" });
    const attentionCase = repo.seedCase({ workspaceId: WORKSPACE_A, studentId: student.id, priority: "HIGH" });
    const reasonA = repo.seedReason({ workspaceId: WORKSPACE_A, attentionCaseId: attentionCase.id, groupId: groupA.id, ruleKey: "absence.consecutive", severity: "MEDIUM" });
    const reasonB = repo.seedReason({ workspaceId: WORKSPACE_A, attentionCaseId: attentionCase.id, groupId: groupB.id, ruleKey: "combined.medium", severity: "HIGH" });
    repo.seedEvidence({ workspaceId: WORKSPACE_A, attentionReasonId: reasonA.id });
    repo.seedEvidence({ workspaceId: WORKSPACE_A, attentionReasonId: reasonB.id });

    const { user: assistantA, context: contextA } = await seedAssistant("assistant-a@example.com", [groupA.id]);
    const { user: assistantB, context: contextB } = await seedAssistant("assistant-b@example.com", [groupB.id]);

    const detailA = await service.getAttentionCase(assistantA, contextA, attentionCase.id);
    expect(detailA.reasons).toHaveLength(1);
    expect(detailA.reasons[0]!.ruleKey).toBe("absence.consecutive");
    expect(detailA.priority).toBe("MEDIUM"); // never leaks Group B's HIGH severity

    const detailB = await service.getAttentionCase(assistantB, contextB, attentionCase.id);
    expect(detailB.reasons).toHaveLength(1);
    expect(detailB.reasons[0]!.ruleKey).toBe("combined.medium");
    expect(detailB.priority).toBe("HIGH");

    const detailOwner = await service.getAttentionCase(owner, ownerContext, attentionCase.id);
    expect(detailOwner.reasons).toHaveLength(2);
    expect(detailOwner.priority).toBe("HIGH");

    // The list endpoint follows the exact same rule.
    const listA = await service.listAttentionCases(assistantA, contextA, {});
    expect(listA.items).toHaveLength(1);
    expect(listA.items[0]!.priority).toBe("MEDIUM");
  });

  it("an assistant with scope over NEITHER group gets a safe no-leak 404 on a case that exists in their own workspace", async () => {
    const student = repo.seedStudent({ workspaceId: WORKSPACE_A, name: "Student" });
    const groupA = repo.seedGroup({ workspaceId: WORKSPACE_A, name: "Group A" });
    const groupC = repo.seedGroup({ workspaceId: WORKSPACE_A, name: "Group C — unrelated" });
    const attentionCase = repo.seedCase({ workspaceId: WORKSPACE_A, studentId: student.id });
    repo.seedReason({ workspaceId: WORKSPACE_A, attentionCaseId: attentionCase.id, groupId: groupA.id, ruleKey: "absence.consecutive" });

    const { user: outsider, context: outsiderContext } = await seedAssistant("outsider@example.com", [groupC.id]);
    await expect(service.getAttentionCase(outsider, outsiderContext, attentionCase.id)).rejects.toBeInstanceOf(ResourceNotFoundException);
    const list = await service.listAttentionCases(outsider, outsiderContext, {});
    expect(list.items).toHaveLength(0);
  });

  // ---------------------------------------------------------------------
  // Lifecycle transitions
  // ---------------------------------------------------------------------

  it("start-followup: NEW -> IN_FOLLOWUP, records an AuditEvent", async () => {
    const student = repo.seedStudent({ workspaceId: WORKSPACE_A, name: "S" });
    const group = repo.seedGroup({ workspaceId: WORKSPACE_A, name: "G" });
    const attentionCase = repo.seedCase({ workspaceId: WORKSPACE_A, studentId: student.id, status: "NEW" });
    repo.seedReason({ workspaceId: WORKSPACE_A, attentionCaseId: attentionCase.id, groupId: group.id, ruleKey: "absence.consecutive" });

    const result = await service.startFollowup(owner, ownerContext, attentionCase.id, { version: 1 }, null);
    expect(result.case.status).toBe("IN_FOLLOWUP");
    expect(repo.auditEvents.some((e) => e.action === "attention_case.in_followup")).toBe(true);
  });

  it("rejects start-followup from a non-NEW status", async () => {
    const student = repo.seedStudent({ workspaceId: WORKSPACE_A, name: "S" });
    const group = repo.seedGroup({ workspaceId: WORKSPACE_A, name: "G" });
    const attentionCase = repo.seedCase({ workspaceId: WORKSPACE_A, studentId: student.id, status: "IN_FOLLOWUP" });
    repo.seedReason({ workspaceId: WORKSPACE_A, attentionCaseId: attentionCase.id, groupId: group.id, ruleKey: "absence.consecutive" });

    await expect(service.startFollowup(owner, ownerContext, attentionCase.id, { version: 1 }, null)).rejects.toBeInstanceOf(
      AttentionCaseInvalidStateException,
    );
  });

  it("returns VERSION_CONFLICT when the supplied version is stale", async () => {
    const student = repo.seedStudent({ workspaceId: WORKSPACE_A, name: "S" });
    const group = repo.seedGroup({ workspaceId: WORKSPACE_A, name: "G" });
    const attentionCase = repo.seedCase({ workspaceId: WORKSPACE_A, studentId: student.id, status: "NEW", version: 3 });
    repo.seedReason({ workspaceId: WORKSPACE_A, attentionCaseId: attentionCase.id, groupId: group.id, ruleKey: "absence.consecutive" });

    await expect(service.startFollowup(owner, ownerContext, attentionCase.id, { version: 1 }, null)).rejects.toBeInstanceOf(
      VersionConflictException,
    );
  });

  it("close is allowed from any non-CLOSED status; closing twice is rejected", async () => {
    const student = repo.seedStudent({ workspaceId: WORKSPACE_A, name: "S" });
    const group = repo.seedGroup({ workspaceId: WORKSPACE_A, name: "G" });
    const attentionCase = repo.seedCase({ workspaceId: WORKSPACE_A, studentId: student.id, status: "MONITORING" });
    repo.seedReason({ workspaceId: WORKSPACE_A, attentionCaseId: attentionCase.id, groupId: group.id, ruleKey: "absence.consecutive" });

    const result = await service.closeCase(owner, ownerContext, attentionCase.id, { version: 1 }, null);
    expect(result.case.status).toBe("CLOSED");

    await expect(service.closeCase(owner, ownerContext, attentionCase.id, { version: 2 }, null)).rejects.toBeInstanceOf(
      AttentionCaseInvalidStateException,
    );
  });

  // ---------------------------------------------------------------------
  // 7: guardian phone never leaks beyond the masked form
  // ---------------------------------------------------------------------

  it("7: contact-draft never returns the guardian's full phone number — only a masked form", async () => {
    const student = repo.seedStudent({ workspaceId: WORKSPACE_A, name: "طالب" });
    const group = repo.seedGroup({ workspaceId: WORKSPACE_A, name: "مجموعة", subject: "رياضيات" });
    const attentionCase = repo.seedCase({ workspaceId: WORKSPACE_A, studentId: student.id });
    repo.seedReason({ workspaceId: WORKSPACE_A, attentionCaseId: attentionCase.id, groupId: group.id, ruleKey: "absence.consecutive" });
    const guardian = repo.seedGuardian({ workspaceId: WORKSPACE_A, phone: "+201234567890", normalizedPhone: "201234567890" });
    repo.seedStudentGuardian({ workspaceId: WORKSPACE_A, studentId: student.id, guardianId: guardian.id, academicContactEnabled: true });

    const sessionId = randomUUID();
    repo.seedSessionGroup(sessionId, group.id);
    repo.seedContactDraftContext(sessionId, {
      sessionId,
      scheduledAt: new Date(),
      groupId: group.id,
      groupName: group.name,
      groupSubject: group.subject,
      attendanceStatus: "ABSENT",
      homeworkStatus: "NOT_DONE",
      examStatus: "NO_EXAM",
      examScore: null,
      examMaxScore: null,
    });

    const draft = await service.contactDraft(owner, ownerContext, attentionCase.id, { guardianId: guardian.id, sessionId });
    // The DISPLAYED guardian identity is masked — the `guardian` object
    // itself never exposes anything but the masked form (no raw `phone`
    // field at all, only `maskedPhone`).
    expect(draft.guardian.maskedPhone).toBe("***7890");
    expect(Object.keys(draft.guardian).sort()).toEqual(["id", "maskedPhone"]);
    expect(JSON.stringify(draft.guardian)).not.toContain("201234567890");
    // The deepLink itself necessarily carries the real digits — a wa.me
    // link only functions with the actual number — this is the one place
    // it legitimately appears, and only because the USER is the one who
    // opens it (never auto-dialed/auto-sent by the server).
    expect(draft.deepLink).toContain("201234567890");
    expect(draft.draft).toContain("طالب");
  });

  it("rejects contact-draft for a guardian with academic contact disabled", async () => {
    const student = repo.seedStudent({ workspaceId: WORKSPACE_A, name: "S" });
    const group = repo.seedGroup({ workspaceId: WORKSPACE_A, name: "G" });
    const attentionCase = repo.seedCase({ workspaceId: WORKSPACE_A, studentId: student.id });
    repo.seedReason({ workspaceId: WORKSPACE_A, attentionCaseId: attentionCase.id, groupId: group.id, ruleKey: "absence.consecutive" });
    const guardian = repo.seedGuardian({ workspaceId: WORKSPACE_A, phone: "+201111111111" });
    repo.seedStudentGuardian({ workspaceId: WORKSPACE_A, studentId: student.id, guardianId: guardian.id, academicContactEnabled: false });
    const sessionId = randomUUID();
    repo.seedSessionGroup(sessionId, group.id);

    await expect(
      service.contactDraft(owner, ownerContext, attentionCase.id, { guardianId: guardian.id, sessionId }),
    ).rejects.toBeInstanceOf(GuardianContactDisabledException);
  });

  it("rejects contact-draft when the session's group is outside the caller's scope", async () => {
    const student = repo.seedStudent({ workspaceId: WORKSPACE_A, name: "S" });
    const groupA = repo.seedGroup({ workspaceId: WORKSPACE_A, name: "A" });
    const groupB = repo.seedGroup({ workspaceId: WORKSPACE_A, name: "B" });
    const attentionCase = repo.seedCase({ workspaceId: WORKSPACE_A, studentId: student.id });
    repo.seedReason({ workspaceId: WORKSPACE_A, attentionCaseId: attentionCase.id, groupId: groupA.id, ruleKey: "absence.consecutive" });
    const guardian = repo.seedGuardian({ workspaceId: WORKSPACE_A, phone: "+201111111111" });
    repo.seedStudentGuardian({ workspaceId: WORKSPACE_A, studentId: student.id, guardianId: guardian.id });

    const { user: assistantA, context: contextA } = await seedAssistant("a@example.com", [groupA.id]);
    const sessionInGroupB = randomUUID();
    repo.seedSessionGroup(sessionInGroupB, groupB.id);

    await expect(
      service.contactDraft(assistantA, contextA, attentionCase.id, { guardianId: guardian.id, sessionId: sessionInGroupB }),
    ).rejects.toBeInstanceOf(ResourceNotFoundException);
  });

  // ---------------------------------------------------------------------
  // 8+9: WhatsApp deeplink never claims send; outcome is saved explicitly
  // ---------------------------------------------------------------------

  it("8: the contact-draft response never claims the message was sent — only a draft and a deeplink", async () => {
    const student = repo.seedStudent({ workspaceId: WORKSPACE_A, name: "S" });
    const group = repo.seedGroup({ workspaceId: WORKSPACE_A, name: "G" });
    const attentionCase = repo.seedCase({ workspaceId: WORKSPACE_A, studentId: student.id });
    repo.seedReason({ workspaceId: WORKSPACE_A, attentionCaseId: attentionCase.id, groupId: group.id, ruleKey: "absence.consecutive" });
    const guardian = repo.seedGuardian({ workspaceId: WORKSPACE_A, phone: "+201234500000" });
    repo.seedStudentGuardian({ workspaceId: WORKSPACE_A, studentId: student.id, guardianId: guardian.id });
    const sessionId = randomUUID();
    repo.seedSessionGroup(sessionId, group.id);
    repo.seedContactDraftContext(sessionId, {
      sessionId,
      scheduledAt: new Date(),
      groupId: group.id,
      groupName: group.name,
      groupSubject: null,
      attendanceStatus: "PRESENT",
      homeworkStatus: "DONE",
      examStatus: "NO_EXAM",
      examScore: null,
      examMaxScore: null,
    });

    const draft = await service.contactDraft(owner, ownerContext, attentionCase.id, { guardianId: guardian.id, sessionId });
    expect(Object.keys(draft).sort()).toEqual(["channel", "deepLink", "draft", "guardian"].sort());
    expect(draft.deepLink).toMatch(/^https:\/\/wa\.me\/\d+\?text=/);
    expect(draft.draft).not.toMatch(/تم الإرسال|تم التسليم|sent|delivered/i);
  });

  it("9: contact outcome is saved explicitly and round-trips exactly as submitted", async () => {
    const student = repo.seedStudent({ workspaceId: WORKSPACE_A, name: "S" });
    const guardian = repo.seedGuardian({ workspaceId: WORKSPACE_A, phone: "+201230000000" });
    repo.seedStudentGuardian({ workspaceId: WORKSPACE_A, studentId: student.id, guardianId: guardian.id });

    const result = await service.createContactLog(owner, ownerContext, {
      studentId: student.id,
      guardianId: guardian.id,
      channel: "WHATSAPP_DEEPLINK",
      draftSnapshot: "نص المسودة كما أُرسل فعليًا",
      outcome: "NO_ANSWER",
    });
    expect(result.contactLog.outcome).toBe("NO_ANSWER");
    expect(result.contactLog.draftSnapshot).toBe("نص المسودة كما أُرسل فعليًا");
    expect(result.scheduledFollowUp).toBeNull();
  });

  it("DEFERRED outcome creates a scheduled follow-up with the given due date", async () => {
    const student = repo.seedStudent({ workspaceId: WORKSPACE_A, name: "S" });
    const group = repo.seedGroup({ workspaceId: WORKSPACE_A, name: "G" });
    const attentionCase = repo.seedCase({ workspaceId: WORKSPACE_A, studentId: student.id });
    repo.seedReason({ workspaceId: WORKSPACE_A, attentionCaseId: attentionCase.id, groupId: group.id, ruleKey: "absence.consecutive" });
    const guardian = repo.seedGuardian({ workspaceId: WORKSPACE_A, phone: "+201230000001" });
    repo.seedStudentGuardian({ workspaceId: WORKSPACE_A, studentId: student.id, guardianId: guardian.id });

    const dueAt = new Date(Date.now() + 86_400_000).toISOString();
    const result = await service.createContactLog(owner, ownerContext, {
      studentId: student.id,
      guardianId: guardian.id,
      attentionCaseId: attentionCase.id,
      channel: "WHATSAPP_DEEPLINK",
      draftSnapshot: "...",
      outcome: "DEFERRED",
      followUpAt: dueAt,
    });
    expect(result.scheduledFollowUp).not.toBeNull();
    expect(result.scheduledFollowUp!.status).toBe("PENDING");
    expect(new Date(result.scheduledFollowUp!.dueAt).toISOString()).toBe(dueAt);
  });

  // ---------------------------------------------------------------------
  // 10: scheduled follow-up due date / reschedule / complete
  // ---------------------------------------------------------------------

  it("10: a scheduled follow-up's due date drives list ordering, and reschedule moves it", async () => {
    const student = repo.seedStudent({ workspaceId: WORKSPACE_A, name: "S" });
    const group = repo.seedGroup({ workspaceId: WORKSPACE_A, name: "G" });
    const attentionCase = repo.seedCase({ workspaceId: WORKSPACE_A, studentId: student.id });
    repo.seedReason({ workspaceId: WORKSPACE_A, attentionCaseId: attentionCase.id, groupId: group.id, ruleKey: "absence.consecutive" });

    const later = repo.seedFollowup({ workspaceId: WORKSPACE_A, attentionCaseId: attentionCase.id, studentId: student.id, dueAt: new Date(Date.now() + 2 * 86_400_000) });
    const sooner = repo.seedFollowup({ workspaceId: WORKSPACE_A, attentionCaseId: attentionCase.id, studentId: student.id, dueAt: new Date(Date.now() + 86_400_000) });

    const list = await service.listFollowups(owner, ownerContext, {});
    expect(list.items.map((f) => f.id)).toEqual([sooner.id, later.id]);

    const newDueAt = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const rescheduled = await service.rescheduleFollowup(owner, ownerContext, sooner.id, { version: 1, dueAt: newDueAt }, null);
    expect(new Date(rescheduled.followUp.dueAt).toISOString()).toBe(newDueAt);

    const completed = await service.completeFollowup(owner, ownerContext, later.id, { version: 1 }, null);
    expect(completed.followUp.status).toBe("DONE");

    await expect(service.completeFollowup(owner, ownerContext, later.id, { version: 2 }, null)).rejects.toBeInstanceOf(
      FollowupInvalidStateException,
    );
  });

  // ---------------------------------------------------------------------
  // Cross-workspace isolation (structural — the DB-level RLS proof lives
  // in the live integration suite; this proves the service layer's own
  // workspace-id check).
  // ---------------------------------------------------------------------

  it("a case belonging to a different workspace is rejected (404 safe-no-leak)", async () => {
    const studentB = repo.seedStudent({ workspaceId: WORKSPACE_B, name: "Other workspace student" });
    const groupB = repo.seedGroup({ workspaceId: WORKSPACE_B, name: "Other workspace group" });
    const foreignCase = repo.seedCase({ workspaceId: WORKSPACE_B, studentId: studentB.id });
    repo.seedReason({ workspaceId: WORKSPACE_B, attentionCaseId: foreignCase.id, groupId: groupB.id, ruleKey: "absence.consecutive" });

    await expect(service.getAttentionCase(owner, ownerContext, foreignCase.id)).rejects.toBeInstanceOf(ResourceNotFoundException);
  });
});
