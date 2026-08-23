import { randomUUID } from "node:crypto";
import {
  generateSessionOccurrencesForRules,
  type CreateMonthTransactionInput,
  type CreateMonthTransactionResult,
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
  workspaceTimezone = "Africa/Cairo";

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

  async runCreateMonthTransaction(
    input: CreateMonthTransactionInput,
  ): Promise<CreateMonthTransactionResult | "MONTH_ALREADY_EXISTS"> {
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
    }

    return { operatingMonth, groupMonths: createdGroupMonths, sessionCount };
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
