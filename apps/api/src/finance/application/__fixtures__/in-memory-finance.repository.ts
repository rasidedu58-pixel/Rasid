import { randomUUID } from "node:crypto";
import {
  OBLIGATION_NOT_FOUND,
  OBLIGATION_NOT_PAYABLE,
  PAYMENT_ALREADY_REVERSED,
  PAYMENT_EXCEEDS_REMAINING,
  PAYMENT_NOT_FOUND,
} from "@academic-precision/database";
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
} from "@academic-precision/database";
import type { FinanceRepositoryPort } from "../ports/finance-repository.port";
import type { InMemoryStudentsRepository } from "../../../students/application/__fixtures__/in-memory-students.repository";

/**
 * In-memory test double for {@link FinanceRepositoryPort} — mirrors
 * `InMemorySessionModeRepository` (Phase 5): wraps a shared
 * {@link InMemoryStudentsRepository} instance (students/enrollments/
 * groupMonths/groups/obligations maps) rather than duplicating that
 * seeding logic, and preserves the same lock/validate/mutate/audit
 * semantics as the real `finance.repository.ts` transactions.
 */
export class InMemoryFinanceRepository implements FinanceRepositoryPort {
  readonly paymentsById = new Map<string, PaymentRow>();
  readonly reversalsById = new Map<string, PaymentReversalRow>();
  readonly idempotencyById = new Map<string, IdempotencyRecordRow>();

  constructor(private readonly shared: InMemoryStudentsRepository) {}

  private now(): Date {
    return new Date();
  }

  async findObligationById(id: string): Promise<FinancialObligationRow | undefined> {
    return this.shared.obligationsById.get(id);
  }

  async findObligationGroupContext(obligationId: string): Promise<ObligationGroupContext | undefined> {
    const obligation = this.shared.obligationsById.get(obligationId);
    if (!obligation) return undefined;
    const enrollment = this.shared.enrollmentsById.get(obligation.enrollmentId);
    if (!enrollment) return undefined;
    const groupMonth = this.shared.groupMonthsById.get(enrollment.groupMonthId);
    if (!groupMonth) return undefined;
    return { workspaceId: obligation.workspaceId, groupId: groupMonth.groupId, groupMonthId: groupMonth.id, studentId: enrollment.studentId };
  }

  async findPaymentById(id: string): Promise<PaymentRow | undefined> {
    return this.paymentsById.get(id);
  }

  async listPaymentsForObligation(obligationId: string): Promise<PaymentRow[]> {
    return [...this.paymentsById.values()]
      .filter((p) => p.obligationId === obligationId)
      .sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime());
  }

  async listObligationsForStudent(params: { workspaceId: string; studentId: string }): Promise<StudentObligationRow[]> {
    const rows: StudentObligationRow[] = [];
    for (const obligation of this.shared.obligationsById.values()) {
      if (obligation.workspaceId !== params.workspaceId) continue;
      const enrollment = this.shared.enrollmentsById.get(obligation.enrollmentId);
      if (!enrollment || enrollment.studentId !== params.studentId) continue;
      const groupMonth = this.shared.groupMonthsById.get(enrollment.groupMonthId);
      if (!groupMonth) continue;
      rows.push({ obligation, groupMonthId: groupMonth.id, groupId: groupMonth.groupId, studentId: params.studentId });
    }
    rows.sort((a, b) => b.obligation.dueDate.localeCompare(a.obligation.dueDate));
    return rows;
  }

  async listCollectionQueue(params: { workspaceId: string; restrictToGroupIds?: string[]; limit: number; cursor?: { dueDate: string; id: string } }): Promise<CollectionQueueRow[]> {
    const rows: CollectionQueueRow[] = [];
    for (const obligation of this.shared.obligationsById.values()) {
      if (obligation.workspaceId !== params.workspaceId) continue;
      if (obligation.status !== "UNPAID" && obligation.status !== "PARTIAL") continue;
      const enrollment = this.shared.enrollmentsById.get(obligation.enrollmentId);
      if (!enrollment) continue;
      const groupMonth = this.shared.groupMonthsById.get(enrollment.groupMonthId);
      if (!groupMonth) continue;
      if (params.restrictToGroupIds !== undefined && !params.restrictToGroupIds.includes(groupMonth.groupId)) continue;
      const student = this.shared.studentsById.get(enrollment.studentId);
      if (!student) continue;
      rows.push({
        obligation,
        studentId: student.id,
        studentName: student.name,
        studentCode: student.studentCode,
        groupMonthId: groupMonth.id,
        groupId: groupMonth.groupId,
      });
    }
    rows.sort(
      (a, b) =>
        a.obligation.dueDate.localeCompare(b.obligation.dueDate) || a.obligation.id.localeCompare(b.obligation.id),
    );
    const afterCursor = params.cursor
      ? rows.filter(
          (r) =>
            r.obligation.dueDate.localeCompare(params.cursor!.dueDate) > 0 ||
            (r.obligation.dueDate === params.cursor!.dueDate && r.obligation.id.localeCompare(params.cursor!.id) > 0),
        )
      : rows;
    return afterCursor.slice(0, params.limit);
  }

  async getFinanceSummary(params: { workspaceId: string; restrictToGroupIds?: string[]; todayIsoDate: string }): Promise<FinanceSummary> {
    const summary: FinanceSummary = {
      totalNetDueMinor: 0,
      totalPaidMinor: 0,
      totalRemainingMinor: 0,
      unpaidCount: 0,
      partialCount: 0,
      paidCount: 0,
      overdueCount: 0,
      overdueRemainingMinor: 0,
    };
    for (const obligation of this.shared.obligationsById.values()) {
      if (obligation.workspaceId !== params.workspaceId) continue;
      const enrollment = this.shared.enrollmentsById.get(obligation.enrollmentId);
      if (!enrollment) continue;
      const groupMonth = this.shared.groupMonthsById.get(enrollment.groupMonthId);
      if (!groupMonth) continue;
      if (params.restrictToGroupIds !== undefined && !params.restrictToGroupIds.includes(groupMonth.groupId)) continue;

      summary.totalNetDueMinor += obligation.netDueMinor;
      summary.totalPaidMinor += obligation.amountPaidMinor;
      summary.totalRemainingMinor += obligation.remainingMinor;
      if (obligation.status === "UNPAID") summary.unpaidCount += 1;
      else if (obligation.status === "PARTIAL") summary.partialCount += 1;
      else if (obligation.status === "PAID") summary.paidCount += 1;
      if (obligation.remainingMinor > 0 && obligation.dueDate < params.todayIsoDate) {
        summary.overdueCount += 1;
        summary.overdueRemainingMinor += obligation.remainingMinor;
      }
    }
    return summary;
  }

  async findStudentById(id: string): Promise<StudentRow | undefined> {
    return this.shared.studentsById.get(id);
  }

  async findEnrollmentById(id: string): Promise<EnrollmentRow | undefined> {
    return this.shared.enrollmentsById.get(id);
  }

  async findGroupMonthById(id: string): Promise<GroupMonthRow | undefined> {
    return this.shared.groupMonthsById.get(id);
  }

  async findGroupById(id: string): Promise<GroupRow | undefined> {
    return this.shared.groupsById.get(id);
  }

  async recordPaymentTransaction(
    input: RecordPaymentInput,
  ): Promise<
    | { obligation: FinancialObligationRow; payment: PaymentRow }
    | typeof OBLIGATION_NOT_FOUND
    | typeof OBLIGATION_NOT_PAYABLE
    | typeof PAYMENT_EXCEEDS_REMAINING
  > {
    const obligation = this.shared.obligationsById.get(input.obligationId);
    if (!obligation || obligation.workspaceId !== input.workspaceId) return OBLIGATION_NOT_FOUND;
    if (obligation.status === "PAID") return OBLIGATION_NOT_PAYABLE;
    if (input.amountMinor <= 0) return OBLIGATION_NOT_PAYABLE;
    if (input.amountMinor > obligation.remainingMinor) return PAYMENT_EXCEEDS_REMAINING;

    const now = this.now();
    const payment: PaymentRow = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      obligationId: input.obligationId,
      amountMinor: input.amountMinor,
      currencyCode: obligation.currencyCode,
      method: input.method,
      paidAt: input.paidAt,
      status: "POSTED",
      note: input.note ?? null,
      idempotencyKey: input.idempotencyKey,
      recordedByUserId: input.recordedByUserId,
      createdAt: now,
    };
    this.paymentsById.set(payment.id, payment);

    const newAmountPaid = obligation.amountPaidMinor + input.amountMinor;
    const newRemaining = obligation.netDueMinor - newAmountPaid;
    const newStatus = newRemaining === 0 ? "PAID" : "PARTIAL";
    const updatedObligation: FinancialObligationRow = {
      ...obligation,
      amountPaidMinor: newAmountPaid,
      remainingMinor: newRemaining,
      status: newStatus,
      updatedAt: now,
      version: obligation.version + 1,
    };
    this.shared.obligationsById.set(obligation.id, updatedObligation);

    this.shared.auditEvents.push({
      workspaceId: input.workspaceId,
      actorUserId: input.recordedByUserId,
      actorMembershipId: input.actorMembershipId,
      action: "payment.recorded",
      entityType: "payment",
      entityId: payment.id,
      afterJson: { obligationId: obligation.id, amountMinor: input.amountMinor },
      correlationId: input.correlationId ?? null,
    });

    return { obligation: updatedObligation, payment };
  }

  async reversePaymentTransaction(
    input: ReversePaymentInput,
  ): Promise<
    | { obligation: FinancialObligationRow; payment: PaymentRow; reversal: PaymentReversalRow }
    | typeof PAYMENT_NOT_FOUND
    | typeof PAYMENT_ALREADY_REVERSED
  > {
    const payment = this.paymentsById.get(input.paymentId);
    if (!payment || payment.workspaceId !== input.workspaceId) return PAYMENT_NOT_FOUND;
    if (payment.status === "REVERSED") return PAYMENT_ALREADY_REVERSED;

    const obligation = this.shared.obligationsById.get(payment.obligationId);
    if (!obligation) throw new Error("Inconsistent fixture: obligation not found for payment.");

    const now = this.now();
    const updatedPayment: PaymentRow = { ...payment, status: "REVERSED" };
    this.paymentsById.set(payment.id, updatedPayment);

    const reversal: PaymentReversalRow = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      paymentId: payment.id,
      reason: input.reason,
      reversedByUserId: input.reversedByUserId,
      reversedAt: now,
      createdAt: now,
    };
    this.reversalsById.set(reversal.id, reversal);

    const newAmountPaid = obligation.amountPaidMinor - payment.amountMinor;
    const newRemaining = obligation.netDueMinor - newAmountPaid;
    const newStatus = newAmountPaid === 0 ? "UNPAID" : newRemaining === 0 ? "PAID" : "PARTIAL";
    const updatedObligation: FinancialObligationRow = {
      ...obligation,
      amountPaidMinor: newAmountPaid,
      remainingMinor: newRemaining,
      status: newStatus,
      updatedAt: now,
      version: obligation.version + 1,
    };
    this.shared.obligationsById.set(obligation.id, updatedObligation);

    this.shared.auditEvents.push({
      workspaceId: input.workspaceId,
      actorUserId: input.reversedByUserId,
      actorMembershipId: input.actorMembershipId,
      action: "payment.reversed",
      entityType: "payment",
      entityId: payment.id,
      beforeJson: { status: payment.status },
      afterJson: { status: updatedPayment.status },
      reason: input.reason,
      correlationId: input.correlationId ?? null,
    });

    return { obligation: updatedObligation, payment: updatedPayment, reversal };
  }

  // ---- Idempotency (mirrors the real generic idempotency_records helpers) ----

  async findIdempotencyRecord(workspaceId: string, operation: string, key: string): Promise<IdempotencyRecordRow | undefined> {
    return [...this.idempotencyById.values()].find(
      (r) => r.workspaceId === workspaceId && r.operation === operation && r.key === key,
    );
  }

  async tryInsertIdempotencyRecord(input: {
    workspaceId: string;
    operation: string;
    key: string;
    requestHash: string;
    expiresAt: Date;
  }): Promise<IdempotencyRecordRow | undefined> {
    const existing = await this.findIdempotencyRecord(input.workspaceId, input.operation, input.key);
    if (existing) return undefined;
    const now = this.now();
    const row: IdempotencyRecordRow = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      operation: input.operation,
      key: input.key,
      requestHash: input.requestHash,
      status: "IN_PROGRESS",
      responseCode: null,
      responsePayload: null,
      createdAt: now,
      updatedAt: now,
      expiresAt: input.expiresAt,
    };
    this.idempotencyById.set(row.id, row);
    return row;
  }

  async completeIdempotencyRecord(id: string, responseCode: number, responsePayload: unknown): Promise<void> {
    const existing = this.idempotencyById.get(id);
    if (!existing) return;
    this.idempotencyById.set(id, { ...existing, status: "COMPLETED", responseCode, responsePayload, updatedAt: this.now() });
  }

  async failIdempotencyRecord(id: string): Promise<void> {
    const existing = this.idempotencyById.get(id);
    if (!existing) return;
    this.idempotencyById.set(id, { ...existing, status: "FAILED_RETRYABLE", updatedAt: this.now() });
  }
}
