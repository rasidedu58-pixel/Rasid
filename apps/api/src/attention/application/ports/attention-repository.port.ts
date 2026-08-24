import type {
  AttentionCaseRow,
  AttentionEvidenceRow,
  AttentionReasonRow,
  ContactDraftSessionContext,
  ContactLogRow,
  EnrollmentRow,
  GroupRow,
  InsertContactLogInput,
  ScheduledFollowupRow,
  StudentGuardianWithGuardian,
  StudentRow,
} from "@academic-precision/database";

/**
 * Port (dependency-inversion boundary) between the Attention/Follow-up
 * application layer and its persistence — mirrors the Phase 1-6
 * `FinanceRepositoryPort`/`SessionModeRepositoryPort` convention exactly.
 * `DrizzleAttentionRepository` is the real implementation; tests supply an
 * in-memory fake.
 */
export interface AttentionRepositoryPort {
  // Cases
  findAttentionCaseById(id: string): Promise<AttentionCaseRow | undefined>;
  listAttentionReasonsForCase(attentionCaseId: string): Promise<AttentionReasonRow[]>;
  listAttentionEvidenceForReasons(attentionReasonIds: string[]): Promise<AttentionEvidenceRow[]>;
  listGroupIdsForAttentionCase(attentionCaseId: string): Promise<string[]>;
  listAttentionCasesForWorkspace(filter: {
    workspaceId: string;
    status?: string;
    restrictToGroupIds?: string[];
    limit: number;
    cursorId?: string;
  }): Promise<AttentionCaseRow[]>;
  updateAttentionCaseStatusWithVersion(input: {
    id: string;
    expectedVersion: number;
    newStatus: "IN_FOLLOWUP" | "CONTACTED" | "MONITORING" | "CLOSED";
  }): Promise<AttentionCaseRow | undefined>;
  /** Phase 11 — batched (no N+1) student name/code lookup for the list-summary DTO. */
  listStudentNamesByIds(workspaceId: string, studentIds: string[]): Promise<Array<{ id: string; name: string; studentCode: string }>>;

  // Follow-ups
  findScheduledFollowupById(id: string): Promise<ScheduledFollowupRow | undefined>;
  listScheduledFollowups(filter: {
    workspaceId: string;
    status?: string;
    restrictToGroupIds?: string[];
    limit: number;
    cursorId?: string;
  }): Promise<ScheduledFollowupRow[]>;
  completeScheduledFollowupWithVersion(input: { id: string; expectedVersion: number }): Promise<ScheduledFollowupRow | undefined>;
  rescheduleScheduledFollowupWithVersion(input: {
    id: string;
    expectedVersion: number;
    newDueAt: Date;
  }): Promise<ScheduledFollowupRow | undefined>;

  // Contact
  insertContactLogTransaction(
    input: InsertContactLogInput,
  ): Promise<{ contactLog: ContactLogRow; scheduledFollowup: ScheduledFollowupRow | null }>;
  findMostRecentContactLogForCase(attentionCaseId: string): Promise<ContactLogRow | undefined>;
  findMostRecentPendingFollowupForCase(attentionCaseId: string): Promise<ScheduledFollowupRow | undefined>;
  findGroupIdForSession(sessionId: string): Promise<string | undefined>;
  findContactDraftSessionContext(params: { sessionId: string; studentId: string }): Promise<ContactDraftSessionContext | undefined>;

  // Reads reused for scope resolution / DTOs (delegate to the same
  // packages/database query helpers Phase 3/4 already use).
  findStudentById(id: string): Promise<StudentRow | undefined>;
  findEnrollmentById(id: string): Promise<EnrollmentRow | undefined>;
  findGroupById(id: string): Promise<GroupRow | undefined>;
  listGroupIdsForStudent(studentId: string): Promise<string[]>;
  listGuardiansForStudent(studentId: string): Promise<StudentGuardianWithGuardian[]>;

  // Audit
  insertAuditEvent(input: {
    workspaceId: string;
    actorUserId: string | null;
    actorMembershipId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    beforeJson?: unknown;
    afterJson?: unknown;
    correlationId?: string | null;
  }): Promise<void>;
}

export const ATTENTION_REPOSITORY = Symbol("ATTENTION_REPOSITORY");
