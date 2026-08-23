import { Injectable } from "@nestjs/common";
import {
  createOrReactivateEnrollmentTransaction,
  findActiveQrForStudent,
  findEnrollmentById,
  findEnrollmentByStudentAndGroupMonth,
  findGroupById,
  findGroupMonthById,
  findGuardianById,
  findQrByTokenHash,
  findStudentById,
  findStudentGuardianById,
  findWorkspaceTimezone,
  generateUniqueStudentCode,
  insertGuardian,
  insertStudent,
  insertStudentGuardian,
  insertStudentsAuditEvent,
  issueQrCredential,
  listGroupIdsForStudent,
  listGuardiansForStudent,
  listSessionsForGroupMonth,
  reissueQrCredentialTransaction,
  searchStudents,
  setPrimaryGuardianTransaction,
  transferEnrollmentTransaction,
  updateStudentGuardian,
  updateStudentWithVersion,
  withdrawEnrollment,
  withRuntimeContext,
  type CreateOrReactivateEnrollmentInput,
  type EnrollmentRow,
  type GroupMonthRow,
  type GroupRow,
  type GuardianRow,
  type InsertGuardianInput,
  type InsertStudentGuardianInput,
  type InsertStudentInput,
  type IssueQrInput,
  type QrCredentialRow,
  type ReissueQrInput,
  type SessionRow,
  type StudentGuardianRow,
  type StudentGuardianWithGuardian,
  type StudentRow,
  type StudentsAuditEventInput,
  type StudentSearchFilter,
  type TransferEnrollmentTransactionInput,
  type UpdateStudentGuardianInput,
  type UpdateStudentInput,
  type WithdrawEnrollmentInput,
} from "@academic-precision/database";
import { getContext } from "@academic-precision/observability";
import type { StudentsRepositoryPort } from "../application/ports/students-repository.port";

/**
 * Real (PostgreSQL/Drizzle) implementation of {@link StudentsRepositoryPort}.
 * Thin adapter only — all persistence/transaction logic lives in
 * packages/database, mirroring `DrizzleSchedulingRepository` (Phase 3).
 * Every method threads the ambient `ExecutionContext` (userId/workspaceId,
 * set by `RequestContextInterceptor` after `PermissionGuard` runs) through
 * `withRuntimeContext` so RLS admits the query.
 */
@Injectable()
export class DrizzleStudentsRepository implements StudentsRepositoryPort {
  private runtimeCtx(workspaceId?: string) {
    const ctx = getContext();
    return { userId: ctx?.userId, workspaceId: workspaceId ?? (ctx?.workspaceId as string | undefined) };
  }

  findWorkspaceTimezone(workspaceId: string): Promise<string | undefined> {
    return withRuntimeContext(this.runtimeCtx(workspaceId), (db) => findWorkspaceTimezone(db, workspaceId));
  }

  findGroupMonthById(id: string): Promise<GroupMonthRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => findGroupMonthById(db, id));
  }

  findGroupById(id: string): Promise<GroupRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => findGroupById(db, id));
  }

  listSessionsForGroupMonth(groupMonthId: string): Promise<SessionRow[]> {
    return withRuntimeContext(this.runtimeCtx(), (db) => listSessionsForGroupMonth(db, groupMonthId));
  }

  generateUniqueStudentCode(workspaceId: string): Promise<string> {
    return withRuntimeContext(this.runtimeCtx(workspaceId), (db) => generateUniqueStudentCode(db, workspaceId));
  }

  findStudentById(id: string): Promise<StudentRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => findStudentById(db, id));
  }

  insertStudent(input: InsertStudentInput): Promise<StudentRow> {
    return withRuntimeContext(this.runtimeCtx(input.workspaceId), (db) => insertStudent(db, input));
  }

  updateStudentWithVersion(
    id: string,
    expectedVersion: number,
    patch: UpdateStudentInput,
  ): Promise<StudentRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => updateStudentWithVersion(db, id, expectedVersion, patch));
  }

  searchStudents(filter: StudentSearchFilter): Promise<StudentRow[]> {
    return withRuntimeContext(this.runtimeCtx(filter.workspaceId), (db) => searchStudents(db, filter));
  }

  listGroupIdsForStudent(studentId: string): Promise<string[]> {
    return withRuntimeContext(this.runtimeCtx(), (db) => listGroupIdsForStudent(db, studentId));
  }

  insertGuardian(input: InsertGuardianInput): Promise<GuardianRow> {
    return withRuntimeContext(this.runtimeCtx(input.workspaceId), (db) => insertGuardian(db, input));
  }

  findGuardianById(id: string): Promise<GuardianRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => findGuardianById(db, id));
  }

  insertStudentGuardian(input: InsertStudentGuardianInput): Promise<StudentGuardianRow> {
    return withRuntimeContext(this.runtimeCtx(input.workspaceId), (db) => insertStudentGuardian(db, input));
  }

  findStudentGuardianById(id: string): Promise<StudentGuardianRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => findStudentGuardianById(db, id));
  }

  listGuardiansForStudent(studentId: string): Promise<StudentGuardianWithGuardian[]> {
    return withRuntimeContext(this.runtimeCtx(), (db) => listGuardiansForStudent(db, studentId));
  }

  updateStudentGuardian(id: string, patch: UpdateStudentGuardianInput): Promise<StudentGuardianRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => updateStudentGuardian(db, id, patch));
  }

  setPrimaryGuardianTransaction(studentId: string, guardianLinkId: string): Promise<StudentGuardianRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => setPrimaryGuardianTransaction(db, studentId, guardianLinkId));
  }

  findActiveQrForStudent(studentId: string): Promise<QrCredentialRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => findActiveQrForStudent(db, studentId));
  }

  findQrByTokenHash(tokenHash: string): Promise<QrCredentialRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => findQrByTokenHash(db, tokenHash));
  }

  issueQrCredential(input: IssueQrInput): Promise<QrCredentialRow> {
    return withRuntimeContext(this.runtimeCtx(input.workspaceId), (db) => issueQrCredential(db, input));
  }

  reissueQrCredentialTransaction(
    input: ReissueQrInput,
  ): Promise<{ revoked: QrCredentialRow | null; issued: QrCredentialRow }> {
    return withRuntimeContext(this.runtimeCtx(input.workspaceId), (db) => reissueQrCredentialTransaction(db, input));
  }

  findEnrollmentById(id: string): Promise<EnrollmentRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => findEnrollmentById(db, id));
  }

  findEnrollmentByStudentAndGroupMonth(studentId: string, groupMonthId: string): Promise<EnrollmentRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) =>
      findEnrollmentByStudentAndGroupMonth(db, studentId, groupMonthId),
    );
  }

  createOrReactivateEnrollmentTransaction(
    input: CreateOrReactivateEnrollmentInput,
  ): Promise<{ enrollment: EnrollmentRow; reactivated: boolean }> {
    return withRuntimeContext(this.runtimeCtx(input.workspaceId), (db) =>
      createOrReactivateEnrollmentTransaction(db, input),
    );
  }

  withdrawEnrollment(input: WithdrawEnrollmentInput): Promise<EnrollmentRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => withdrawEnrollment(db, input));
  }

  transferEnrollmentTransaction(
    input: TransferEnrollmentTransactionInput,
  ): Promise<{ source: EnrollmentRow; target: EnrollmentRow; reactivated: boolean } | undefined> {
    return withRuntimeContext(this.runtimeCtx(input.targetWorkspaceId), (db) =>
      transferEnrollmentTransaction(db, input),
    );
  }

  insertAuditEvent(input: StudentsAuditEventInput): Promise<void> {
    return withRuntimeContext(this.runtimeCtx(input.workspaceId), (db) => insertStudentsAuditEvent(db, input));
  }
}
