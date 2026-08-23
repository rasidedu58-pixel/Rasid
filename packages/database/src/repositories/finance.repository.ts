/**
 * Finance repository — Phase 6.
 *
 * Typed query helpers + transactional operations, containing no HTTP/
 * framework concerns — mirrors `session-mode.repository.ts`'s convention
 * exactly. Business/authorization decisions (permission checks, scope
 * filtering) live in apps/api's application service layer, NOT here.
 *
 * The Payment ledger + FinancialObligation ARE the source of truth
 * (Database Schema §8.1's own callout). `amount_paid_minor`/
 * `remaining_minor`/`status` on `financial_obligations` are cached
 * aggregates, recomputed ONLY inside `recordPaymentTransaction`/
 * `reversePaymentTransaction` — never touched anywhere else.
 */
import { and, desc, eq, inArray, sql as rawSql } from "drizzle-orm";
import { financialObligations, payments, paymentReversals } from "../schema/finance";
import { enrollments } from "../schema/enrollments";
import { groupMonths } from "../schema/groups";
import { students } from "../schema/students";
import { auditEvents } from "../schema/audit";
import { outboxEvents } from "../schema/outbox";
import type { Db } from "./identity.repository";

export type FinancialObligationRow = typeof financialObligations.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
export type PaymentReversalRow = typeof paymentReversals.$inferSelect;

const UNPAID = "UNPAID";
const PARTIAL = "PARTIAL";
const PAID = "PAID";

// ---------------------------------------------------------------------------
// Obligation creation/refresh — called from WITHIN enrollment create/
// reactivate/transfer transactions (students.repository.ts), never as its
// own top-level transaction, so it participates in the SAME atomic unit as
// the enrollment write it is derived from.
// ---------------------------------------------------------------------------

export interface ObligationTerms {
  baseFeeMinor: number;
  currencyCode: string;
  dueDate: string; // "YYYY-MM-DD"
  calculationBasis: "FULL_MONTH" | "CUSTOM" | "REMAINING_SESSIONS";
  calculationSnapshotJson: unknown;
}

/**
 * At most ONE obligation ever exists per enrollment (UNIQUE(enrollment_id),
 * enforced by the DB) — an Enrollment's row is REUSED across
 * join→withdraw→rejoin cycles (INT-08), so this function is itself a
 * create-or-refresh:
 * - No existing row → INSERT (status UNPAID, amount_paid=0, remaining=net_due).
 * - Existing row still UNPAID with zero payment activity → safe to REFRESH
 *   the terms (fee may have been recalculated for a new join_date) — no
 *   ledger history to protect yet.
 * - Existing row PARTIAL/PAID (real payment activity exists) → left
 *   COMPLETELY UNTOUCHED. PLAN's own Definition of Done: "paid/partial
 *   obligation لا تتغير صامتًا بعد fee change." Re-enrolling a student who
 *   already has ledger history against this exact obligation is a real
 *   product edge case the docs don't resolve explicitly — leaving the
 *   existing obligation alone is the only behavior that cannot violate
 *   that rule, so it was chosen over inventing a reconciliation flow.
 */
export async function upsertObligationForEnrollment(
  tx: Db,
  input: { workspaceId: string; enrollmentId: string } & ObligationTerms,
): Promise<{ obligation: FinancialObligationRow; created: boolean; refreshed: boolean }> {
  const [existing] = await tx
    .select()
    .from(financialObligations)
    .where(eq(financialObligations.enrollmentId, input.enrollmentId))
    .limit(1);

  if (!existing) {
    const [inserted] = await tx
      .insert(financialObligations)
      .values({
        workspaceId: input.workspaceId,
        enrollmentId: input.enrollmentId,
        currencyCode: input.currencyCode,
        baseFeeMinor: input.baseFeeMinor,
        discountMinor: 0,
        waiverMinor: 0,
        netDueMinor: input.baseFeeMinor,
        dueDate: input.dueDate,
        amountPaidMinor: 0,
        remainingMinor: input.baseFeeMinor,
        status: UNPAID,
        calculationBasis: input.calculationBasis,
        calculationSnapshotJson: input.calculationSnapshotJson,
      })
      .returning();
    if (!inserted) throw new Error("Failed to insert financial_obligations row.");
    return { obligation: inserted, created: true, refreshed: false };
  }

  if (existing.status !== UNPAID || existing.amountPaidMinor !== 0) {
    // Real ledger activity — never silently touched.
    return { obligation: existing, created: false, refreshed: false };
  }

  const [updated] = await tx
    .update(financialObligations)
    .set({
      currencyCode: input.currencyCode,
      baseFeeMinor: input.baseFeeMinor,
      netDueMinor: input.baseFeeMinor,
      dueDate: input.dueDate,
      remainingMinor: input.baseFeeMinor,
      calculationBasis: input.calculationBasis,
      calculationSnapshotJson: input.calculationSnapshotJson,
      updatedAt: new Date(),
      version: existing.version + 1,
    })
    .where(eq(financialObligations.id, existing.id))
    .returning();
  if (!updated) throw new Error("Failed to refresh financial_obligations row.");
  return { obligation: updated, created: false, refreshed: true };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function findObligationById(db: Db, id: string): Promise<FinancialObligationRow | undefined> {
  return db.select().from(financialObligations).where(eq(financialObligations.id, id)).limit(1).then((r) => r[0]);
}

export function findObligationByEnrollmentId(db: Db, enrollmentId: string): Promise<FinancialObligationRow | undefined> {
  return db
    .select()
    .from(financialObligations)
    .where(eq(financialObligations.enrollmentId, enrollmentId))
    .limit(1)
    .then((r) => r[0]);
}

export function listPaymentsForObligation(db: Db, obligationId: string): Promise<PaymentRow[]> {
  return db.select().from(payments).where(eq(payments.obligationId, obligationId)).orderBy(desc(payments.paidAt));
}

export function findPaymentById(db: Db, id: string): Promise<PaymentRow | undefined> {
  return db.select().from(payments).where(eq(payments.id, id)).limit(1).then((r) => r[0]);
}

export interface ObligationGroupContext {
  groupId: string;
  groupMonthId: string;
  studentId: string;
}

/** Resolves the Group an obligation's Enrollment belongs to — the Group Scope anchor for `payments.record`/`payments.view_student_status` checks. */
export async function findObligationGroupContext(db: Db, obligationId: string): Promise<ObligationGroupContext | undefined> {
  const [row] = await db
    .select({ groupId: groupMonths.groupId, groupMonthId: groupMonths.id, studentId: enrollments.studentId })
    .from(financialObligations)
    .innerJoin(enrollments, eq(enrollments.id, financialObligations.enrollmentId))
    .innerJoin(groupMonths, eq(groupMonths.id, enrollments.groupMonthId))
    .where(eq(financialObligations.id, obligationId))
    .limit(1);
  return row;
}

export interface StudentObligationRow {
  obligation: FinancialObligationRow;
  groupMonthId: string;
  groupId: string;
  studentId: string;
}

/**
 * "Month-separated obligations" (API §9.6) — every obligation across every
 * Enrollment this Student has ever had (possibly across several different
 * Groups after a Transfer), newest due date first. Includes `groupId` so
 * the application layer can filter to the caller's Group Scope — a
 * SELECTED_GROUPS caller must never see an obligation from a Group they
 * aren't granted, even for a Student they otherwise have access to.
 */
export async function listObligationsForStudent(
  db: Db,
  params: { workspaceId: string; studentId: string },
): Promise<StudentObligationRow[]> {
  const rows = await db
    .select({
      obligation: financialObligations,
      groupMonthId: enrollments.groupMonthId,
      groupId: groupMonths.groupId,
      studentId: enrollments.studentId,
    })
    .from(financialObligations)
    .innerJoin(enrollments, eq(enrollments.id, financialObligations.enrollmentId))
    .innerJoin(groupMonths, eq(groupMonths.id, enrollments.groupMonthId))
    .where(and(eq(financialObligations.workspaceId, params.workspaceId), eq(enrollments.studentId, params.studentId)))
    .orderBy(desc(financialObligations.dueDate));
  return rows;
}

export interface CollectionQueueRow {
  obligation: FinancialObligationRow;
  studentId: string;
  studentName: string;
  studentCode: string;
  groupMonthId: string;
  groupId: string;
}

/**
 * Collection Queue (API §9.6 `/finance/collection-queue`): obligations with
 * remaining balance (UNPAID/PARTIAL), optionally restricted to a caller's
 * SELECTED_GROUPS grant — mirrors `StudentSearchFilter.restrictToGroupIds`'s
 * exact convention from the Phase 4 Group-Scope Security Delta.
 */
export async function listCollectionQueue(
  db: Db,
  params: { workspaceId: string; restrictToGroupIds?: string[]; limit: number },
): Promise<CollectionQueueRow[]> {
  const conditions = [
    eq(financialObligations.workspaceId, params.workspaceId),
    inArray(financialObligations.status, [UNPAID, PARTIAL]),
  ];
  if (params.restrictToGroupIds !== undefined) {
    conditions.push(
      params.restrictToGroupIds.length === 0
        ? rawSql`false`
        : inArray(groupMonths.groupId, params.restrictToGroupIds),
    );
  }

  const rows = await db
    .select({
      obligation: financialObligations,
      studentId: students.id,
      studentName: students.name,
      studentCode: students.studentCode,
      groupMonthId: groupMonths.id,
      groupId: groupMonths.groupId,
    })
    .from(financialObligations)
    .innerJoin(enrollments, eq(enrollments.id, financialObligations.enrollmentId))
    .innerJoin(groupMonths, eq(groupMonths.id, enrollments.groupMonthId))
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .where(and(...conditions))
    .orderBy(financialObligations.dueDate)
    .limit(params.limit);
  return rows;
}

export interface FinanceSummary {
  totalNetDueMinor: number;
  totalPaidMinor: number;
  totalRemainingMinor: number;
  unpaidCount: number;
  partialCount: number;
  paidCount: number;
  overdueCount: number;
  overdueRemainingMinor: number;
}

/** `/finance/summary` (API §9.6) — workspace/group-scoped aggregate. "Overdue" is DERIVED (due_date < today AND remaining>0), never a stored status (PRD §7's own state-machine note). */
export async function getFinanceSummary(
  db: Db,
  params: { workspaceId: string; restrictToGroupIds?: string[]; todayIsoDate: string },
): Promise<FinanceSummary> {
  const conditions = [eq(financialObligations.workspaceId, params.workspaceId)];
  if (params.restrictToGroupIds !== undefined) {
    conditions.push(
      params.restrictToGroupIds.length === 0
        ? rawSql`false`
        : inArray(groupMonths.groupId, params.restrictToGroupIds),
    );
  }

  const [row] = await db
    .select({
      totalNetDueMinor: rawSql<string>`COALESCE(SUM(${financialObligations.netDueMinor}), 0)`,
      totalPaidMinor: rawSql<string>`COALESCE(SUM(${financialObligations.amountPaidMinor}), 0)`,
      totalRemainingMinor: rawSql<string>`COALESCE(SUM(${financialObligations.remainingMinor}), 0)`,
      unpaidCount: rawSql<string>`COUNT(*) FILTER (WHERE ${financialObligations.status} = 'UNPAID')`,
      partialCount: rawSql<string>`COUNT(*) FILTER (WHERE ${financialObligations.status} = 'PARTIAL')`,
      paidCount: rawSql<string>`COUNT(*) FILTER (WHERE ${financialObligations.status} = 'PAID')`,
      overdueCount: rawSql<string>`COUNT(*) FILTER (WHERE ${financialObligations.remainingMinor} > 0 AND ${financialObligations.dueDate} < ${params.todayIsoDate})`,
      overdueRemainingMinor: rawSql<string>`COALESCE(SUM(${financialObligations.remainingMinor}) FILTER (WHERE ${financialObligations.remainingMinor} > 0 AND ${financialObligations.dueDate} < ${params.todayIsoDate}), 0)`,
    })
    .from(financialObligations)
    .innerJoin(enrollments, eq(enrollments.id, financialObligations.enrollmentId))
    .innerJoin(groupMonths, eq(groupMonths.id, enrollments.groupMonthId))
    .where(and(...conditions));

  return {
    totalNetDueMinor: Number(row?.totalNetDueMinor ?? 0),
    totalPaidMinor: Number(row?.totalPaidMinor ?? 0),
    totalRemainingMinor: Number(row?.totalRemainingMinor ?? 0),
    unpaidCount: Number(row?.unpaidCount ?? 0),
    partialCount: Number(row?.partialCount ?? 0),
    paidCount: Number(row?.paidCount ?? 0),
    overdueCount: Number(row?.overdueCount ?? 0),
    overdueRemainingMinor: Number(row?.overdueRemainingMinor ?? 0),
  };
}

// ---------------------------------------------------------------------------
// RecordPayment — Database Schema §17.1's exact transaction shape (steps
// 3-8; idempotency-record lifecycle (steps 2/9) is orchestrated by the
// application service layer, matching the established CreateMonth/
// CompleteSession convention).
// ---------------------------------------------------------------------------

export interface RecordPaymentInput {
  workspaceId: string;
  obligationId: string;
  amountMinor: number;
  method: "CASH" | "TRANSFER" | "WALLET" | "OTHER";
  paidAt: Date;
  note?: string | null;
  idempotencyKey: string;
  recordedByUserId: string;
  actorMembershipId: string | null;
  correlationId?: string | null;
}

export const OBLIGATION_NOT_FOUND = "OBLIGATION_NOT_FOUND" as const;
export const OBLIGATION_NOT_PAYABLE = "OBLIGATION_NOT_PAYABLE" as const;
export const PAYMENT_EXCEEDS_REMAINING = "PAYMENT_EXCEEDS_REMAINING" as const;

export async function recordPaymentTransaction(
  db: Db,
  input: RecordPaymentInput,
): Promise<
  | { obligation: FinancialObligationRow; payment: PaymentRow }
  | typeof OBLIGATION_NOT_FOUND
  | typeof OBLIGATION_NOT_PAYABLE
  | typeof PAYMENT_EXCEEDS_REMAINING
> {
  return db.transaction(async (tx) => {
    // Step 3: SELECT obligation FOR UPDATE.
    const [obligation] = await tx
      .select()
      .from(financialObligations)
      .where(and(eq(financialObligations.id, input.obligationId), eq(financialObligations.workspaceId, input.workspaceId)))
      .for("update");
    if (!obligation) return OBLIGATION_NOT_FOUND;
    if (obligation.status === PAID) return OBLIGATION_NOT_PAYABLE;

    // Step 4: amount > 0 (zod already enforces this at the request boundary
    // — re-checked here as the transactional authority) and <= remaining.
    if (input.amountMinor <= 0) return OBLIGATION_NOT_PAYABLE;
    if (input.amountMinor > obligation.remainingMinor) return PAYMENT_EXCEEDS_REMAINING;

    // Step 5: INSERT payment (POSTED).
    const [payment] = await tx
      .insert(payments)
      .values({
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
      })
      .returning();
    if (!payment) throw new Error("Failed to insert payments row.");

    // Step 6: recalc cached aggregates.
    const newAmountPaid = obligation.amountPaidMinor + input.amountMinor;
    const newRemaining = obligation.netDueMinor - newAmountPaid;
    const newStatus = newRemaining === 0 ? PAID : PARTIAL;
    const [updatedObligation] = await tx
      .update(financialObligations)
      .set({ amountPaidMinor: newAmountPaid, remainingMinor: newRemaining, status: newStatus, updatedAt: new Date(), version: obligation.version + 1 })
      .where(eq(financialObligations.id, obligation.id))
      .returning();
    if (!updatedObligation) throw new Error("Failed to update financial_obligations row.");

    // Step 7: AuditEvent (same transaction — explicitly part of the "Record
    // payment | Atomic | Payment + obligation aggregates + audit + outbox"
    // scope, API Contract §17).
    await tx.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.recordedByUserId,
      actorMembershipId: input.actorMembershipId,
      action: "payment.recorded",
      entityType: "payment",
      entityId: payment.id,
      afterJson: { obligationId: obligation.id, amountMinor: input.amountMinor, method: input.method, status: payment.status },
      correlationId: input.correlationId ?? null,
    });

    // Step 8: OutboxEvent(PaymentPosted).
    await tx.insert(outboxEvents).values({
      workspaceId: input.workspaceId,
      eventType: "PaymentPosted",
      aggregateType: "Payment",
      aggregateId: payment.id,
      payload: { paymentId: payment.id, obligationId: obligation.id, amountMinor: input.amountMinor },
    });

    return { obligation: updatedObligation, payment };
  });
}

// ---------------------------------------------------------------------------
// ReversePayment — same shape as RecordPayment (lock, validate, mutate,
// audit, outbox, all one transaction). No dedicated §17.x pseudocode block
// exists for reversal in the approved docs (only RecordPayment/
// CompleteSession/CreateMonth are numbered) — this mirrors RecordPayment's
// own steps 3/5-8 exactly, applied to the reversal shape, per SCHEMA §8.3's
// "Transaction تعيد حساب obligation وتضيف Audit + Outbox" rule.
// ---------------------------------------------------------------------------

export interface ReversePaymentInput {
  workspaceId: string;
  paymentId: string;
  reason: string;
  reversedByUserId: string;
  actorMembershipId: string | null;
  correlationId?: string | null;
}

export const PAYMENT_NOT_FOUND = "PAYMENT_NOT_FOUND" as const;
export const PAYMENT_ALREADY_REVERSED = "PAYMENT_ALREADY_REVERSED" as const;

export async function reversePaymentTransaction(
  db: Db,
  input: ReversePaymentInput,
): Promise<
  | { obligation: FinancialObligationRow; payment: PaymentRow; reversal: PaymentReversalRow }
  | typeof PAYMENT_NOT_FOUND
  | typeof PAYMENT_ALREADY_REVERSED
> {
  return db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.id, input.paymentId), eq(payments.workspaceId, input.workspaceId)))
      .for("update");
    if (!payment) return PAYMENT_NOT_FOUND;
    if (payment.status === "REVERSED") return PAYMENT_ALREADY_REVERSED;

    const [obligation] = await tx
      .select()
      .from(financialObligations)
      .where(eq(financialObligations.id, payment.obligationId))
      .for("update");
    if (!obligation) throw new Error("Payment references a missing financial_obligations row.");

    const [updatedPayment] = await tx
      .update(payments)
      .set({ status: "REVERSED" })
      .where(eq(payments.id, payment.id))
      .returning();
    if (!updatedPayment) throw new Error("Failed to update payments row.");

    const [reversal] = await tx
      .insert(paymentReversals)
      .values({
        workspaceId: input.workspaceId,
        paymentId: payment.id,
        reason: input.reason,
        reversedByUserId: input.reversedByUserId,
      })
      .returning();
    if (!reversal) throw new Error("Failed to insert payment_reversals row.");

    const newAmountPaid = obligation.amountPaidMinor - payment.amountMinor;
    const newRemaining = obligation.netDueMinor - newAmountPaid;
    const newStatus = newAmountPaid === 0 ? UNPAID : newRemaining === 0 ? PAID : PARTIAL;
    const [updatedObligation] = await tx
      .update(financialObligations)
      .set({ amountPaidMinor: newAmountPaid, remainingMinor: newRemaining, status: newStatus, updatedAt: new Date(), version: obligation.version + 1 })
      .where(eq(financialObligations.id, obligation.id))
      .returning();
    if (!updatedObligation) throw new Error("Failed to update financial_obligations row.");

    await tx.insert(auditEvents).values({
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

    await tx.insert(outboxEvents).values({
      workspaceId: input.workspaceId,
      eventType: "PaymentReversed",
      aggregateType: "Payment",
      aggregateId: payment.id,
      payload: { paymentId: payment.id, obligationId: obligation.id, amountMinor: payment.amountMinor },
    });

    return { obligation: updatedObligation, payment: updatedPayment, reversal };
  });
}
