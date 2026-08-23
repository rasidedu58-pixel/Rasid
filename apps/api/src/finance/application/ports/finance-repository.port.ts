import type {
  CollectionQueueRow,
  EnrollmentRow,
  FinanceSummary,
  FinancialObligationRow,
  GroupMonthRow,
  GroupRow,
  IdempotencyRecordRow,
  ObligationGroupContext,
  PaymentReversalRow,
  PaymentRow,
  RecordPaymentInput,
  ReversePaymentInput,
  StudentObligationRow,
  StudentRow,
  OBLIGATION_NOT_FOUND,
  OBLIGATION_NOT_PAYABLE,
  PAYMENT_ALREADY_REVERSED,
  PAYMENT_EXCEEDS_REMAINING,
  PAYMENT_NOT_FOUND,
} from "@academic-precision/database";

/**
 * Port (dependency-inversion boundary) between the Finance application
 * layer and its persistence — mirrors the Phase 1-5
 * `SchedulingRepositoryPort`/`StudentsRepositoryPort`/
 * `SessionModeRepositoryPort` convention exactly. `DrizzleFinanceRepository`
 * is the real implementation; tests supply an in-memory fake.
 */
export interface FinanceRepositoryPort {
  findObligationById(id: string): Promise<FinancialObligationRow | undefined>;
  findObligationGroupContext(obligationId: string): Promise<ObligationGroupContext | undefined>;
  findPaymentById(id: string): Promise<PaymentRow | undefined>;
  listPaymentsForObligation(obligationId: string): Promise<PaymentRow[]>;
  listObligationsForStudent(params: { workspaceId: string; studentId: string }): Promise<StudentObligationRow[]>;
  listCollectionQueue(params: { workspaceId: string; restrictToGroupIds?: string[]; limit: number }): Promise<CollectionQueueRow[]>;
  getFinanceSummary(params: { workspaceId: string; restrictToGroupIds?: string[]; todayIsoDate: string }): Promise<FinanceSummary>;

  // Reads reused for scope resolution / DTOs (delegate to the same
  // packages/database query helpers Phase 3/4 already use).
  findStudentById(id: string): Promise<StudentRow | undefined>;
  findEnrollmentById(id: string): Promise<EnrollmentRow | undefined>;
  findGroupMonthById(id: string): Promise<GroupMonthRow | undefined>;
  findGroupById(id: string): Promise<GroupRow | undefined>;

  recordPaymentTransaction(
    input: RecordPaymentInput,
  ): Promise<
    | { obligation: FinancialObligationRow; payment: PaymentRow }
    | typeof OBLIGATION_NOT_FOUND
    | typeof OBLIGATION_NOT_PAYABLE
    | typeof PAYMENT_EXCEEDS_REMAINING
  >;

  reversePaymentTransaction(
    input: ReversePaymentInput,
  ): Promise<
    | { obligation: FinancialObligationRow; payment: PaymentRow; reversal: PaymentReversalRow }
    | typeof PAYMENT_NOT_FOUND
    | typeof PAYMENT_ALREADY_REVERSED
  >;

  // Idempotency (shared table/mechanism with Phase 3/5's CreateMonth/CompleteSession)
  findIdempotencyRecord(workspaceId: string, operation: string, key: string): Promise<IdempotencyRecordRow | undefined>;
  tryInsertIdempotencyRecord(input: {
    workspaceId: string;
    operation: string;
    key: string;
    requestHash: string;
    expiresAt: Date;
  }): Promise<IdempotencyRecordRow | undefined>;
  completeIdempotencyRecord(id: string, responseCode: number, responsePayload: unknown): Promise<void>;
  failIdempotencyRecord(id: string): Promise<void>;
}

export const FINANCE_REPOSITORY = Symbol("FINANCE_REPOSITORY");
