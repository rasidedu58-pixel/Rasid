import { Injectable } from "@nestjs/common";
import {
  completeIdempotencyRecord,
  failIdempotencyRecord,
  findEnrollmentById,
  findGroupById,
  findGroupMonthById,
  findIdempotencyRecord,
  findObligationById,
  findObligationGroupContext,
  findPaymentById,
  findStudentById,
  getFinanceSummary,
  listCollectionQueue,
  listObligationsForStudent,
  listPaymentsForObligation,
  recordPaymentTransaction,
  reversePaymentTransaction,
  tryInsertIdempotencyRecord,
  withRuntimeContext,
  type CollectionQueueRow,
  type EnrollmentRow,
  type FinanceSummary,
  type FinancialObligationRow,
  type GroupMonthRow,
  type GroupRow,
  type IdempotencyRecordRow,
  type ObligationGroupContext,
  type PaymentReversalRow,
  type PaymentRow,
  type RecordPaymentInput,
  type ReversePaymentInput,
  type StudentObligationRow,
  type StudentRow,
} from "@academic-precision/database";
import { getContext } from "@academic-precision/observability";
import type { FinanceRepositoryPort } from "../application/ports/finance-repository.port";

/**
 * Real (PostgreSQL/Drizzle) implementation of {@link FinanceRepositoryPort}.
 * Thin adapter only — all persistence/transaction logic lives in
 * packages/database, mirroring `DrizzleSessionModeRepository` (Phase 5).
 */
@Injectable()
export class DrizzleFinanceRepository implements FinanceRepositoryPort {
  private runtimeCtx(workspaceId?: string) {
    const ctx = getContext();
    return { userId: ctx?.userId, workspaceId: workspaceId ?? (ctx?.workspaceId as string | undefined) };
  }

  findObligationById(id: string): Promise<FinancialObligationRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => findObligationById(db, id));
  }

  findObligationGroupContext(obligationId: string): Promise<ObligationGroupContext | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => findObligationGroupContext(db, obligationId));
  }

  findPaymentById(id: string): Promise<PaymentRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => findPaymentById(db, id));
  }

  listPaymentsForObligation(obligationId: string): Promise<PaymentRow[]> {
    return withRuntimeContext(this.runtimeCtx(), (db) => listPaymentsForObligation(db, obligationId));
  }

  listObligationsForStudent(params: { workspaceId: string; studentId: string }): Promise<StudentObligationRow[]> {
    return withRuntimeContext(this.runtimeCtx(params.workspaceId), (db) => listObligationsForStudent(db, params));
  }

  listCollectionQueue(params: { workspaceId: string; restrictToGroupIds?: string[]; limit: number; cursor?: { dueDate: string; id: string } }): Promise<CollectionQueueRow[]> {
    return withRuntimeContext(this.runtimeCtx(params.workspaceId), (db) => listCollectionQueue(db, params));
  }

  getFinanceSummary(params: { workspaceId: string; restrictToGroupIds?: string[]; todayIsoDate: string }): Promise<FinanceSummary> {
    return withRuntimeContext(this.runtimeCtx(params.workspaceId), (db) => getFinanceSummary(db, params));
  }

  findStudentById(id: string): Promise<StudentRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => findStudentById(db, id));
  }

  findEnrollmentById(id: string): Promise<EnrollmentRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => findEnrollmentById(db, id));
  }

  findGroupMonthById(id: string): Promise<GroupMonthRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => findGroupMonthById(db, id));
  }

  findGroupById(id: string): Promise<GroupRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(), (db) => findGroupById(db, id));
  }

  recordPaymentTransaction(input: RecordPaymentInput) {
    return withRuntimeContext(this.runtimeCtx(input.workspaceId), (db) => recordPaymentTransaction(db, input));
  }

  reversePaymentTransaction(input: ReversePaymentInput) {
    return withRuntimeContext(this.runtimeCtx(input.workspaceId), (db) => reversePaymentTransaction(db, input));
  }

  findIdempotencyRecord(workspaceId: string, operation: string, key: string): Promise<IdempotencyRecordRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(workspaceId), (db) => findIdempotencyRecord(db, workspaceId, operation, key));
  }

  tryInsertIdempotencyRecord(input: {
    workspaceId: string;
    operation: string;
    key: string;
    requestHash: string;
    expiresAt: Date;
  }): Promise<IdempotencyRecordRow | undefined> {
    return withRuntimeContext(this.runtimeCtx(input.workspaceId), (db) => tryInsertIdempotencyRecord(db, input));
  }

  completeIdempotencyRecord(id: string, responseCode: number, responsePayload: unknown): Promise<void> {
    return withRuntimeContext(this.runtimeCtx(), (db) => completeIdempotencyRecord(db, id, responseCode, responsePayload));
  }

  failIdempotencyRecord(id: string): Promise<void> {
    return withRuntimeContext(this.runtimeCtx(), (db) => failIdempotencyRecord(db, id));
  }
}
