import { randomUUID } from "node:crypto";
import {
  computeObligationDueDate,
  generateSessionOccurrencesForRules,
  type CarryForwardStats,
  type CreateMonthTransactionInput,
  type CreateMonthTransactionResult,
  type EnrollmentRow,
  type FinancialObligationRow,
  type GroupMonthRow,
  type GroupRow,
  type IdempotencyRecordRow,
  type InsertGroupInput,
  type ListSessionsFilter,
  type OperatingMonthRow,
  type RescheduleInput,
  type ScheduleApplyInput,
  type ScheduleApplyResult,
  type ScheduleRuleRow,
  type SchedulingAuditEventInput,
  type SessionRow,
  type UpdateGroupInput,
} from "@academic-precision/database";
import type { SchedulingRepositoryPort } from "../ports/scheduling-repository.port";

const CARRY_FORWARD_FEE_METHOD_REQUIRED = "CARRY_FORWARD_FEE_METHOD_REQUIRED" as const;
const CARRY_FORWARD_DUE_DAY_UNRESOLVED = "CARRY_FORWARD_DUE_DAY_UNRESOLVED" as const;

class CarryForwardFeeMethodRequiredMarker extends Error {}
class CarryForwardDueDayUnresolvedMarker extends Error {}

/**
 * In-memory test double for {@link SchedulingRepositoryPort} — mirrors
 * `InMemoryTeamRepository` (Phase 2): no live Postgres needed for unit
 * tests, but preserves the same transactional/optimistic-concurrency/
 * append-only semantics as the real Drizzle repository.
 */
export class InMemorySchedulingRepository implements SchedulingRepositoryPort {
  readonly groupsById = new Map<string, GroupRow>();
  readonly monthsById = new Map<string, OperatingMonthRow>();
  readonly groupMonthsById = new Map<string, GroupMonthRow>();
  readonly scheduleRulesById = new Map<string, ScheduleRuleRow>();
  readonly sessionsById = new Map<string, SessionRow>();
  readonly idempotencyById = new Map<string, IdempotencyRecordRow>();
  readonly auditEvents: SchedulingAuditEventInput[] = [];
  readonly outboxEvents: Array<{ eventType: string; aggregateId: string; payload: unknown }> = [];
  /** Carry-Forward (Phase 6 Closure Delta) — self-contained, mirrors `students.repository.ts`'s enrollment/obligation shape; SchedulingService never calls into StudentsRepositoryPort, so these don't need to be shared with `InMemoryStudentsRepository`. */
  readonly enrollmentsById = new Map<string, EnrollmentRow>();
  readonly obligationsById = new Map<string, FinancialObligationRow>();
  workspaceTimezone = "Africa/Cairo";
  /** Workspace's `unifiedDueDay` fallback, used only when a carried-forward group has no `dueDay` of its own. */
  workspaceUnifiedDueDay: number | null = null;

  private now(): Date {
    return new Date();
  }

  // ---- seeding helpers -----------------------------------------------

  seedGroup(input: Partial<GroupRow> & { workspaceId: string; name: string }): GroupRow {
    const now = this.now();
    const row: GroupRow = {
      id: input.id ?? randomUUID(),
      workspaceId: input.workspaceId,
      name: input.name,
      subject: input.subject ?? null,
      grade: input.grade ?? null,
      defaultLocationId: input.defaultLocationId ?? null,
      status: input.status ?? "ACTIVE",
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      archivedAt: input.archivedAt ?? null,
      version: input.version ?? 1,
    };
    this.groupsById.set(row.id, row);
    return row;
  }

  seedMonth(input: Partial<OperatingMonthRow> & { workspaceId: string; year: number; month: number; createdByUserId: string }): OperatingMonthRow {
    const now = this.now();
    const row: OperatingMonthRow = {
      id: input.id ?? randomUUID(),
      workspaceId: input.workspaceId,
      year: input.year,
      month: input.month,
      status: input.status ?? "CURRENT",
      createdByUserId: input.createdByUserId,
      createdAt: input.createdAt ?? now,
      activatedAt: input.activatedAt ?? now,
      archivedAt: input.archivedAt ?? null,
      version: input.version ?? 1,
    };
    this.monthsById.set(row.id, row);
    return row;
  }

  seedGroupMonth(
    input: Partial<GroupMonthRow> & { workspaceId: string; groupId: string; operatingMonthId: string },
  ): GroupMonthRow {
    const now = this.now();
    const row: GroupMonthRow = {
      id: input.id ?? randomUUID(),
      workspaceId: input.workspaceId,
      groupId: input.groupId,
      operatingMonthId: input.operatingMonthId,
      locationId: input.locationId ?? null,
      baseFeeMinor: input.baseFeeMinor ?? 10000,
      currencyCode: input.currencyCode ?? "EGP",
      duePolicy: input.duePolicy ?? "PER_GROUP",
      dueDay: input.dueDay ?? null,
      joinFeePolicy: input.joinFeePolicy ?? "FULL",
      monthlyStatus: input.monthlyStatus ?? "ACTIVE",
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      version: input.version ?? 1,
    };
    this.groupMonthsById.set(row.id, row);
    return row;
  }

  seedSession(input: Partial<SessionRow> & { workspaceId: string; groupMonthId: string; createdByUserId: string }): SessionRow {
    const now = this.now();
    const row: SessionRow = {
      id: input.id ?? randomUUID(),
      workspaceId: input.workspaceId,
      groupMonthId: input.groupMonthId,
      scheduledAt: input.scheduledAt ?? now,
      durationMinutes: input.durationMinutes ?? 60,
      status: input.status ?? "SCHEDULED",
      origin: input.origin ?? "MANUAL",
      rescheduledFromSessionId: input.rescheduledFromSessionId ?? null,
      billableForProration: input.billableForProration ?? false,
      startedAt: input.startedAt ?? null,
      completedAt: input.completedAt ?? null,
      cancelledAt: input.cancelledAt ?? null,
      createdByUserId: input.createdByUserId,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      version: input.version ?? 1,
    };
    this.sessionsById.set(row.id, row);
    return row;
  }

  seedEnrollment(
    input: Partial<EnrollmentRow> & { workspaceId: string; studentId: string; groupMonthId: string },
  ): EnrollmentRow {
    const now = this.now();
    const row: EnrollmentRow = {
      id: input.id ?? randomUUID(),
      workspaceId: input.workspaceId,
      studentId: input.studentId,
      groupMonthId: input.groupMonthId,
      joinDate: input.joinDate ?? "2026-08-01",
      status: input.status ?? "ACTIVE",
      feeMethod: input.feeMethod ?? "FULL_MONTH",
      customFeeMinor: input.customFeeMinor ?? null,
      endedAt: input.endedAt ?? null,
      endReason: input.endReason ?? null,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      version: input.version ?? 1,
    };
    this.enrollmentsById.set(row.id, row);
    return row;
  }

  seedObligation(
    input: Partial<FinancialObligationRow> & { workspaceId: string; enrollmentId: string; baseFeeMinor: number },
  ): FinancialObligationRow {
    const now = this.now();
    const row: FinancialObligationRow = {
      id: input.id ?? randomUUID(),
      workspaceId: input.workspaceId,
      enrollmentId: input.enrollmentId,
      currencyCode: input.currencyCode ?? "EGP",
      baseFeeMinor: input.baseFeeMinor,
      discountMinor: input.discountMinor ?? 0,
      waiverMinor: input.waiverMinor ?? 0,
      netDueMinor: input.netDueMinor ?? input.baseFeeMinor,
      dueDate: input.dueDate ?? "2026-08-15",
      amountPaidMinor: input.amountPaidMinor ?? 0,
      remainingMinor: input.remainingMinor ?? input.baseFeeMinor,
      status: input.status ?? "UNPAID",
      calculationBasis: input.calculationBasis ?? "FULL_MONTH",
      calculationSnapshotJson: input.calculationSnapshotJson ?? null,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      version: input.version ?? 1,
    };
    this.obligationsById.set(row.id, row);
    return row;
  }

  private upsertObligationInMemory(
    workspaceId: string,
    enrollmentId: string,
    terms: {
      baseFeeMinor: number;
      currencyCode: string;
      dueDate: string;
      calculationBasis: "FULL_MONTH" | "CUSTOM" | "REMAINING_SESSIONS";
      calculationSnapshotJson: unknown;
    },
  ): FinancialObligationRow {
    const existing = [...this.obligationsById.values()].find((o) => o.enrollmentId === enrollmentId);
    if (existing) {
      // Mirrors `upsertObligationForEnrollment` — never touches real ledger activity.
      if (existing.status !== "UNPAID" || existing.amountPaidMinor !== 0) return existing;
    }
    return this.seedObligation({
      id: existing?.id,
      workspaceId,
      enrollmentId,
      baseFeeMinor: terms.baseFeeMinor,
      currencyCode: terms.currencyCode,
      netDueMinor: terms.baseFeeMinor,
      dueDate: terms.dueDate,
      remainingMinor: terms.baseFeeMinor,
      calculationBasis: terms.calculationBasis,
      calculationSnapshotJson: terms.calculationSnapshotJson,
      version: existing ? existing.version + 1 : 1,
    });
  }

  // ---- SchedulingRepositoryPort ---------------------------------------

  async findWorkspaceTimezone(): Promise<string | undefined> {
    return this.workspaceTimezone;
  }

  async listGroups(workspaceId: string): Promise<GroupRow[]> {
    return [...this.groupsById.values()].filter((g) => g.workspaceId === workspaceId);
  }

  async findGroupById(groupId: string): Promise<GroupRow | undefined> {
    return this.groupsById.get(groupId);
  }

  async insertGroup(input: InsertGroupInput): Promise<GroupRow> {
    return this.seedGroup({
      workspaceId: input.workspaceId,
      name: input.name,
      subject: input.subject ?? null,
      grade: input.grade ?? null,
      defaultLocationId: input.defaultLocationId ?? null,
    });
  }

  async updateGroupWithVersion(
    groupId: string,
    expectedVersion: number,
    patch: UpdateGroupInput,
  ): Promise<GroupRow | undefined> {
    const existing = this.groupsById.get(groupId);
    if (!existing || existing.version !== expectedVersion) return undefined;
    const updated: GroupRow = { ...existing, ...patch, updatedAt: this.now(), version: expectedVersion + 1 };
    this.groupsById.set(groupId, updated);
    return updated;
  }

  async listOperatingMonths(workspaceId: string): Promise<OperatingMonthRow[]> {
    return [...this.monthsById.values()].filter((m) => m.workspaceId === workspaceId);
  }

  async findOperatingMonthById(id: string): Promise<OperatingMonthRow | undefined> {
    return this.monthsById.get(id);
  }

  async findOperatingMonthByYearMonth(
    workspaceId: string,
    year: number,
    month: number,
  ): Promise<OperatingMonthRow | undefined> {
    return [...this.monthsById.values()].find(
      (m) => m.workspaceId === workspaceId && m.year === year && m.month === month,
    );
  }

  async listGroupMonthsForOperatingMonth(operatingMonthId: string): Promise<GroupMonthRow[]> {
    return [...this.groupMonthsById.values()].filter((gm) => gm.operatingMonthId === operatingMonthId);
  }

  async findGroupMonthById(id: string): Promise<GroupMonthRow | undefined> {
    return this.groupMonthsById.get(id);
  }

  async listScheduleRulesForGroupMonth(groupMonthId: string): Promise<ScheduleRuleRow[]> {
    return [...this.scheduleRulesById.values()].filter((r) => r.groupMonthId === groupMonthId);
  }

  async updateGroupMonthWithVersion(
    groupMonthId: string,
    expectedVersion: number,
    patch: Partial<{
      locationId: string | null;
      baseFeeMinor: number;
      duePolicy: string;
      dueDay: number | null;
      joinFeePolicy: string;
    }>,
  ): Promise<GroupMonthRow | undefined> {
    const existing = this.groupMonthsById.get(groupMonthId);
    if (!existing || existing.version !== expectedVersion) return undefined;
    const updated: GroupMonthRow = { ...existing, ...patch, updatedAt: this.now(), version: expectedVersion + 1 };
    this.groupMonthsById.set(groupMonthId, updated);
    return updated;
  }

  async applyScheduleChangeTransaction(input: ScheduleApplyInput): Promise<ScheduleApplyResult> {
    for (const [id, rule] of this.scheduleRulesById.entries()) {
      if (rule.groupMonthId === input.groupMonthId) this.scheduleRulesById.delete(id);
    }

    const insertedRules: ScheduleRuleRow[] = input.newRules.map((rule) => {
      const now = this.now();
      const row: ScheduleRuleRow = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        groupMonthId: input.groupMonthId,
        weekday: rule.weekday,
        startTime: rule.startTime,
        durationMinutes: rule.durationMinutes,
        effectiveFrom: rule.effectiveFrom ?? null,
        effectiveTo: rule.effectiveTo ?? null,
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      this.scheduleRulesById.set(row.id, row);
      return row;
    });

    const cancelledSessionIds: string[] = [];
    for (const session of this.sessionsById.values()) {
      if (
        session.groupMonthId === input.groupMonthId &&
        session.status === "SCHEDULED" &&
        session.scheduledAt.getTime() > input.now.getTime()
      ) {
        this.sessionsById.set(session.id, {
          ...session,
          status: "CANCELLED",
          cancelledAt: input.now,
          updatedAt: input.now,
        });
        cancelledSessionIds.push(session.id);
      }
    }

    const occurrences = generateSessionOccurrencesForRules({
      workspaceTimezone: input.workspaceTimezone,
      year: input.targetYear,
      month: input.targetMonth,
      rules: input.newRules,
    }).filter((o) => o.scheduledAt.getTime() > input.now.getTime());

    const createdSessions: SessionRow[] = occurrences.map((occurrence) =>
      this.seedSession({
        workspaceId: input.workspaceId,
        groupMonthId: input.groupMonthId,
        scheduledAt: occurrence.scheduledAt,
        durationMinutes: occurrence.durationMinutes,
        status: "SCHEDULED",
        origin: "GENERATED",
        billableForProration: true,
        createdByUserId: input.createdByUserId,
      }),
    );

    return { cancelledSessionIds, createdSessions, scheduleRules: insertedRules };
  }

  async findSessionById(id: string): Promise<SessionRow | undefined> {
    return this.sessionsById.get(id);
  }

  async listSessions(filter: ListSessionsFilter): Promise<SessionRow[]> {
    let rows = [...this.sessionsById.values()].filter((s) => s.workspaceId === filter.workspaceId);
    if (filter.groupMonthId) rows = rows.filter((s) => s.groupMonthId === filter.groupMonthId);
    if (filter.status) rows = rows.filter((s) => s.status === filter.status);
    if (filter.scheduledFrom) rows = rows.filter((s) => s.scheduledAt >= filter.scheduledFrom!);
    if (filter.scheduledTo) rows = rows.filter((s) => s.scheduledAt <= filter.scheduledTo!);
    rows.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime() || a.id.localeCompare(b.id));
    if (filter.cursorScheduledAt && filter.cursorId) {
      rows = rows.filter(
        (s) =>
          s.scheduledAt.getTime() > filter.cursorScheduledAt!.getTime() ||
          (s.scheduledAt.getTime() === filter.cursorScheduledAt!.getTime() && s.id > filter.cursorId!),
      );
    }
    return rows.slice(0, filter.limit);
  }

  async cancelSessionIfScheduled(sessionId: string): Promise<SessionRow | undefined> {
    const existing = this.sessionsById.get(sessionId);
    if (!existing || existing.status !== "SCHEDULED") return undefined;
    const now = this.now();
    const updated: SessionRow = { ...existing, status: "CANCELLED", cancelledAt: now, updatedAt: now };
    this.sessionsById.set(sessionId, updated);
    return updated;
  }

  async rescheduleSessionTransaction(
    input: RescheduleInput,
  ): Promise<{ original: SessionRow; replacement: SessionRow } | undefined> {
    const original = this.sessionsById.get(input.originalSessionId);
    if (!original || original.status !== "SCHEDULED") return undefined;

    const existingReplacement = [...this.sessionsById.values()].find(
      (s) => s.rescheduledFromSessionId === input.originalSessionId,
    );
    if (existingReplacement) return undefined;

    const now = this.now();
    const updatedOriginal: SessionRow = { ...original, status: "RESCHEDULED", updatedAt: now };
    this.sessionsById.set(original.id, updatedOriginal);

    const replacement = this.seedSession({
      workspaceId: original.workspaceId,
      groupMonthId: original.groupMonthId,
      scheduledAt: input.newScheduledAt,
      durationMinutes: input.newDurationMinutes,
      status: "SCHEDULED",
      origin: "RESCHEDULE_REPLACEMENT",
      rescheduledFromSessionId: original.id,
      billableForProration: true,
      createdByUserId: input.createdByUserId,
    });

    return { original: updatedOriginal, replacement };
  }

  /** Snapshots every Map/array this "transaction" can mutate, so a thrown error (marker or otherwise) can be rolled back exactly like a real Postgres `db.transaction` — "no half-created month" must hold in the unit-test double too, not just against live Postgres. */
  private snapshot() {
    return {
      monthsById: new Map(this.monthsById),
      groupMonthsById: new Map(this.groupMonthsById),
      scheduleRulesById: new Map(this.scheduleRulesById),
      sessionsById: new Map(this.sessionsById),
      enrollmentsById: new Map(this.enrollmentsById),
      obligationsById: new Map(this.obligationsById),
      auditEventsLength: this.auditEvents.length,
      outboxEventsLength: this.outboxEvents.length,
    };
  }

  private restore(snap: ReturnType<InMemorySchedulingRepository["snapshot"]>): void {
    this.monthsById.clear();
    for (const [k, v] of snap.monthsById) this.monthsById.set(k, v);
    this.groupMonthsById.clear();
    for (const [k, v] of snap.groupMonthsById) this.groupMonthsById.set(k, v);
    this.scheduleRulesById.clear();
    for (const [k, v] of snap.scheduleRulesById) this.scheduleRulesById.set(k, v);
    this.sessionsById.clear();
    for (const [k, v] of snap.sessionsById) this.sessionsById.set(k, v);
    this.enrollmentsById.clear();
    for (const [k, v] of snap.enrollmentsById) this.enrollmentsById.set(k, v);
    this.obligationsById.clear();
    for (const [k, v] of snap.obligationsById) this.obligationsById.set(k, v);
    this.auditEvents.length = snap.auditEventsLength;
    this.outboxEvents.length = snap.outboxEventsLength;
  }

  async runCreateMonthTransaction(
    input: CreateMonthTransactionInput,
  ): Promise<
    | CreateMonthTransactionResult
    | "MONTH_ALREADY_EXISTS"
    | typeof CARRY_FORWARD_FEE_METHOD_REQUIRED
    | typeof CARRY_FORWARD_DUE_DAY_UNRESOLVED
  > {
    const snap = this.snapshot();
    try {
      return this.runCreateMonthTransactionInner(input);
    } catch (err) {
      this.restore(snap);
      if (err instanceof CarryForwardFeeMethodRequiredMarker) return CARRY_FORWARD_FEE_METHOD_REQUIRED;
      if (err instanceof CarryForwardDueDayUnresolvedMarker) return CARRY_FORWARD_DUE_DAY_UNRESOLVED;
      throw err;
    }
  }

  private runCreateMonthTransactionInner(
    input: CreateMonthTransactionInput,
  ): CreateMonthTransactionResult | "MONTH_ALREADY_EXISTS" {
    const duplicate = [...this.monthsById.values()].find(
      (m) => m.workspaceId === input.workspaceId && m.year === input.targetYear && m.month === input.targetMonth,
    );
    if (duplicate) return "MONTH_ALREADY_EXISTS";

    const previousCurrent = [...this.monthsById.values()].find(
      (m) => m.workspaceId === input.workspaceId && m.status === "CURRENT",
    );
    if (previousCurrent) {
      this.monthsById.set(previousCurrent.id, { ...previousCurrent, status: "ARCHIVED", archivedAt: this.now() });
    }

    const operatingMonth = this.seedMonth({
      workspaceId: input.workspaceId,
      year: input.targetYear,
      month: input.targetMonth,
      status: "CURRENT",
      createdByUserId: input.createdByUserId,
    });

    const createdGroupMonths: GroupMonthRow[] = [];
    let sessionCount = 0;
    let enrollmentCount = 0;
    const firstOfMonthIso = `${input.targetYear}-${String(input.targetMonth).padStart(2, "0")}-01`;

    for (const spec of input.groupSpecs) {
      const groupMonth = this.seedGroupMonth({
        workspaceId: input.workspaceId,
        groupId: spec.groupId,
        operatingMonthId: operatingMonth.id,
        locationId: spec.locationId,
        baseFeeMinor: spec.baseFeeMinor,
        currencyCode: spec.currencyCode,
        duePolicy: spec.duePolicy,
        dueDay: spec.dueDay,
        joinFeePolicy: spec.joinFeePolicy,
      });
      createdGroupMonths.push(groupMonth);

      for (const rule of spec.scheduleRules) {
        const now = this.now();
        const row: ScheduleRuleRow = {
          id: randomUUID(),
          workspaceId: input.workspaceId,
          groupMonthId: groupMonth.id,
          weekday: rule.weekday,
          startTime: rule.startTime,
          durationMinutes: rule.durationMinutes,
          effectiveFrom: rule.effectiveFrom ?? null,
          effectiveTo: rule.effectiveTo ?? null,
          createdAt: now,
          updatedAt: now,
          version: 1,
        };
        this.scheduleRulesById.set(row.id, row);
      }

      const occurrences = generateSessionOccurrencesForRules({
        workspaceTimezone: input.workspaceTimezone,
        year: input.targetYear,
        month: input.targetMonth,
        rules: spec.scheduleRules,
      });
      for (const occurrence of occurrences) {
        this.seedSession({
          workspaceId: input.workspaceId,
          groupMonthId: groupMonth.id,
          scheduledAt: occurrence.scheduledAt,
          durationMinutes: occurrence.durationMinutes,
          status: "SCHEDULED",
          origin: "GENERATED",
          billableForProration: true,
          createdByUserId: input.createdByUserId,
        });
        sessionCount += 1;
      }

      if (spec.sourceGroupMonthId) {
        const sourceEnrollments = [...this.enrollmentsById.values()].filter(
          (e) => e.groupMonthId === spec.sourceGroupMonthId && e.status === "ACTIVE",
        );

        if (sourceEnrollments.length > 0 && spec.joinFeePolicy === "ASK_EVERY_TIME") {
          throw new CarryForwardFeeMethodRequiredMarker(spec.groupId);
        }

        const dueDay = spec.dueDay ?? this.workspaceUnifiedDueDay ?? null;

        for (const source of sourceEnrollments) {
          if (dueDay === null) {
            throw new CarryForwardDueDayUnresolvedMarker(spec.groupId);
          }
          const dueDate = computeObligationDueDate({
            year: input.targetYear,
            month: input.targetMonth,
            dueDay,
            workspaceTimezone: input.workspaceTimezone,
          });

          const newEnrollment = this.seedEnrollment({
            workspaceId: input.workspaceId,
            studentId: source.studentId,
            groupMonthId: groupMonth.id,
            joinDate: firstOfMonthIso,
            status: "ACTIVE",
            feeMethod: "FULL_MONTH",
            customFeeMinor: null,
          });
          enrollmentCount += 1;

          this.upsertObligationInMemory(input.workspaceId, newEnrollment.id, {
            baseFeeMinor: spec.baseFeeMinor,
            currencyCode: spec.currencyCode,
            dueDate,
            calculationBasis: "FULL_MONTH",
            calculationSnapshotJson: {
              source: "CARRY_FORWARD",
              sourceEnrollmentId: source.id,
              sourceGroupMonthId: spec.sourceGroupMonthId,
              joinFeePolicy: spec.joinFeePolicy,
            },
          });
        }
      }
    }

    this.auditEvents.push({
      workspaceId: input.workspaceId,
      actorUserId: input.createdByUserId,
      actorMembershipId: input.createdByMembershipId,
      action: "month.created",
      entityType: "operating_month",
      entityId: operatingMonth.id,
      afterJson: { operatingMonthId: operatingMonth.id, groupMonthCount: createdGroupMonths.length, sessionCount, enrollmentCount },
      correlationId: input.correlationId ?? null,
    });
    this.outboxEvents.push({
      eventType: "MonthCreated",
      aggregateId: operatingMonth.id,
      payload: { operatingMonthId: operatingMonth.id, groupMonthCount: createdGroupMonths.length, sessionCount, enrollmentCount },
    });

    return { operatingMonth, groupMonths: createdGroupMonths, sessionCount, enrollmentCount };
  }

  async getCarryForwardStats(sourceGroupMonthId: string): Promise<CarryForwardStats> {
    const rows = [...this.enrollmentsById.values()].filter((e) => e.groupMonthId === sourceGroupMonthId);
    const stats: CarryForwardStats = { continuing: 0, excluded: 0, transferred: 0, continuingStudentIds: [] };
    for (const row of rows) {
      if (row.status === "ACTIVE") {
        stats.continuing += 1;
        stats.continuingStudentIds.push(row.studentId);
      } else if (row.status === "TRANSFERRED") {
        stats.transferred += 1;
      } else {
        stats.excluded += 1;
      }
    }
    return stats;
  }

  async countStudentsWithOldDebt(workspaceId: string, studentIds: string[]): Promise<number> {
    if (studentIds.length === 0) return 0;
    const studentIdSet = new Set(studentIds);
    const enrollmentIdToStudentId = new Map(
      [...this.enrollmentsById.values()].map((e) => [e.id, e.studentId] as const),
    );
    const withDebt = new Set<string>();
    for (const obligation of this.obligationsById.values()) {
      if (obligation.workspaceId !== workspaceId || obligation.remainingMinor <= 0) continue;
      const studentId = enrollmentIdToStudentId.get(obligation.enrollmentId);
      if (studentId && studentIdSet.has(studentId)) withDebt.add(studentId);
    }
    return withDebt.size;
  }

  async findIdempotencyRecord(
    workspaceId: string,
    operation: string,
    key: string,
  ): Promise<IdempotencyRecordRow | undefined> {
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
    this.idempotencyById.set(id, {
      ...existing,
      status: "COMPLETED",
      responseCode,
      responsePayload: responsePayload as never,
      updatedAt: this.now(),
    });
  }

  async failIdempotencyRecord(id: string): Promise<void> {
    const existing = this.idempotencyById.get(id);
    if (!existing) return;
    this.idempotencyById.set(id, { ...existing, status: "FAILED_RETRYABLE", updatedAt: this.now() });
  }

  async insertAuditEvent(input: SchedulingAuditEventInput): Promise<void> {
    this.auditEvents.push(input);
  }
}
