import { Injectable } from "@nestjs/common";
import {
  completeScheduledFollowupWithVersion,
  findAttentionCaseById,
  findContactDraftSessionContext,
  findEnrollmentById,
  findGroupById,
  findGroupIdForSession,
  findMostRecentContactLogForCase,
  findMostRecentPendingFollowupForCase,
  findScheduledFollowupById,
  findStudentById,
  insertAttentionAuditEvent,
  insertContactLogTransaction,
  listAttentionCasesForWorkspace,
  listAttentionEvidenceForReasons,
  listAttentionReasonsForCase,
  listGroupIdsForAttentionCase,
  listGroupIdsForStudent,
  listGuardiansForStudent,
  listScheduledFollowups,
  rescheduleScheduledFollowupWithVersion,
  updateAttentionCaseStatusWithVersion,
  withRuntimeContext,
  type AttentionCaseRow,
  type AttentionEvidenceRow,
  type AttentionReasonRow,
  type ContactDraftSessionContext,
  type ContactLogRow,
  type EnrollmentRow,
  type GroupRow,
  type InsertContactLogInput,
  type ScheduledFollowupRow,
  type StudentGuardianWithGuardian,
  type StudentRow,
} from "@academic-precision/database";
import { getContext } from "@academic-precision/observability";
import type { AttentionRepositoryPort } from "../application/ports/attention-repository.port";

/**
 * Real (PostgreSQL/Drizzle) implementation of {@link AttentionRepositoryPort}
 * — thin adapter only, all persistence/transaction logic lives in
 * packages/database, mirroring `DrizzleFinanceRepository` (Phase 6). Every
 * method threads the ambient `ExecutionContext` through `withRuntimeContext`
 * so RLS admits the query — this is the `app_runtime` role; rule-engine
 * writes happen exclusively on the separate `app_worker` connection (see
 * packages/database/src/worker/outbox-dispatcher.ts), never here.
 */
@Injectable()
export class DrizzleAttentionRepository implements AttentionRepositoryPort {
  private runtimeCtx(workspaceId?: string) {
    const ctx = getContext();
    return { userId: ctx?.userId, workspaceId: workspaceId ?? (ctx?.workspaceId as string | undefined) };
  }

  findAttentionCaseById(id: string): Promise<AttentionCaseRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => findAttentionCaseById(db, id));
  }

  listAttentionReasonsForCase(attentionCaseId: string): Promise<AttentionReasonRow[]> {
    return withRuntimeContext(this.runtimeCtx(), (db) => listAttentionReasonsForCase(db, attentionCaseId));
  }

  listAttentionEvidenceForReasons(attentionReasonIds: string[]): Promise<AttentionEvidenceRow[]> {
    return withRuntimeContext(this.runtimeCtx(), (db) => listAttentionEvidenceForReasons(db, attentionReasonIds));
  }

  listGroupIdsForAttentionCase(attentionCaseId: string): Promise<string[]> {
    return withRuntimeContext(this.runtimeCtx(), (db) => listGroupIdsForAttentionCase(db, attentionCaseId));
  }

  listAttentionCasesForWorkspace(filter: {
    workspaceId: string;
    status?: string;
    restrictToGroupIds?: string[];
    limit: number;
    cursorId?: string;
  }): Promise<AttentionCaseRow[]> {
    return withRuntimeContext(this.runtimeCtx(filter.workspaceId), (db) => listAttentionCasesForWorkspace(db, filter));
  }

  updateAttentionCaseStatusWithVersion(input: {
    id: string;
    expectedVersion: number;
    newStatus: "IN_FOLLOWUP" | "CONTACTED" | "MONITORING" | "CLOSED";
  }): Promise<AttentionCaseRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => updateAttentionCaseStatusWithVersion(db, input));
  }

  findScheduledFollowupById(id: string): Promise<ScheduledFollowupRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => findScheduledFollowupById(db, id));
  }

  listScheduledFollowups(filter: {
    workspaceId: string;
    status?: string;
    restrictToGroupIds?: string[];
    limit: number;
    cursorId?: string;
  }): Promise<ScheduledFollowupRow[]> {
    return withRuntimeContext(this.runtimeCtx(filter.workspaceId), (db) => listScheduledFollowups(db, filter));
  }

  completeScheduledFollowupWithVersion(input: { id: string; expectedVersion: number }): Promise<ScheduledFollowupRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => completeScheduledFollowupWithVersion(db, input));
  }

  rescheduleScheduledFollowupWithVersion(input: {
    id: string;
    expectedVersion: number;
    newDueAt: Date;
  }): Promise<ScheduledFollowupRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => rescheduleScheduledFollowupWithVersion(db, input));
  }

  insertContactLogTransaction(
    input: InsertContactLogInput,
  ): Promise<{ contactLog: ContactLogRow; scheduledFollowup: ScheduledFollowupRow | null }> {
    return withRuntimeContext(this.runtimeCtx(input.workspaceId), (db) => insertContactLogTransaction(db, input));
  }

  findMostRecentContactLogForCase(attentionCaseId: string): Promise<ContactLogRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => findMostRecentContactLogForCase(db, attentionCaseId));
  }

  findMostRecentPendingFollowupForCase(attentionCaseId: string): Promise<ScheduledFollowupRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => findMostRecentPendingFollowupForCase(db, attentionCaseId));
  }

  findGroupIdForSession(sessionId: string): Promise<string | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => findGroupIdForSession(db, sessionId));
  }

  findContactDraftSessionContext(params: { sessionId: string; studentId: string }): Promise<ContactDraftSessionContext | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => findContactDraftSessionContext(db, params));
  }

  findStudentById(id: string): Promise<StudentRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => findStudentById(db, id));
  }

  findEnrollmentById(id: string): Promise<EnrollmentRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => findEnrollmentById(db, id));
  }

  findGroupById(id: string): Promise<GroupRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => findGroupById(db, id));
  }

  listGroupIdsForStudent(studentId: string): Promise<string[]> {
    return withRuntimeContext(this.runtimeCtx(), (db) => listGroupIdsForStudent(db, studentId));
  }

  listGuardiansForStudent(studentId: string): Promise<StudentGuardianWithGuardian[]> {
    return withRuntimeContext(this.runtimeCtx(), (db) => listGuardiansForStudent(db, studentId));
  }

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
  }): Promise<void> {
    return withRuntimeContext(this.runtimeCtx(input.workspaceId), (db) => insertAttentionAuditEvent(db, input));
  }
}
