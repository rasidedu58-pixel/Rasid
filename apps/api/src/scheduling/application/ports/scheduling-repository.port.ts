import type {
  CreateMonthTransactionInput,
  CreateMonthTransactionResult,
  GroupMonthRow,
  GroupRow,
  IdempotencyRecordRow,
  InsertGroupInput,
  ListSessionsFilter,
  OperatingMonthRow,
  RescheduleInput,
  ScheduleApplyInput,
  ScheduleApplyResult,
  ScheduleRuleRow,
  SchedulingAuditEventInput,
  SessionRow,
  UpdateGroupInput,
} from "@academic-precision/database";

/**
 * Port (dependency-inversion boundary) between the scheduling application
 * layer and its persistence — mirrors the Phase 1/2 `TeamRepositoryPort`
 * convention exactly. `DrizzleSchedulingRepository` is the real
 * implementation; tests supply an in-memory fake.
 */
export interface SchedulingRepositoryPort {
  findWorkspaceTimezone(workspaceId: string): Promise<string | undefined>;

  // Groups
  listGroups(workspaceId: string): Promise<GroupRow[]>;
  findGroupById(groupId: string): Promise<GroupRow | undefined>;
  insertGroup(input: InsertGroupInput): Promise<GroupRow>;
  updateGroupWithVersion(
    groupId: string,
    expectedVersion: number,
    patch: UpdateGroupInput,
  ): Promise<GroupRow | undefined>;

  // Months
  listOperatingMonths(workspaceId: string): Promise<OperatingMonthRow[]>;
  findOperatingMonthById(id: string): Promise<OperatingMonthRow | undefined>;
  findOperatingMonthByYearMonth(
    workspaceId: string,
    year: number,
    month: number,
  ): Promise<OperatingMonthRow | undefined>;

  // GroupMonth / schedule
  listGroupMonthsForOperatingMonth(operatingMonthId: string): Promise<GroupMonthRow[]>;
  findGroupMonthById(id: string): Promise<GroupMonthRow | undefined>;
  listScheduleRulesForGroupMonth(groupMonthId: string): Promise<ScheduleRuleRow[]>;
  updateGroupMonthWithVersion(
    groupMonthId: string,
    expectedVersion: number,
    patch: Partial<{
      locationId: string | null;
      baseFeeMinor: number;
      duePolicy: string;
      dueDay: number | null;
      joinFeePolicy: string;
    }>,
  ): Promise<GroupMonthRow | undefined>;
  applyScheduleChangeTransaction(input: ScheduleApplyInput): Promise<ScheduleApplyResult>;

  // Sessions
  findSessionById(id: string): Promise<SessionRow | undefined>;
  listSessions(filter: ListSessionsFilter): Promise<SessionRow[]>;
  cancelSessionIfScheduled(sessionId: string): Promise<SessionRow | undefined>;
  rescheduleSessionTransaction(
    input: RescheduleInput,
  ): Promise<{ original: SessionRow; replacement: SessionRow } | undefined>;

  // CreateMonth
  runCreateMonthTransaction(
    input: CreateMonthTransactionInput,
  ): Promise<CreateMonthTransactionResult | "MONTH_ALREADY_EXISTS">;

  // Idempotency
  findIdempotencyRecord(
    workspaceId: string,
    operation: string,
    key: string,
  ): Promise<IdempotencyRecordRow | undefined>;
  tryInsertIdempotencyRecord(input: {
    workspaceId: string;
    operation: string;
    key: string;
    requestHash: string;
    expiresAt: Date;
  }): Promise<IdempotencyRecordRow | undefined>;
  completeIdempotencyRecord(id: string, responseCode: number, responsePayload: unknown): Promise<void>;
  failIdempotencyRecord(id: string): Promise<void>;

  // Audit
  insertAuditEvent(input: SchedulingAuditEventInput): Promise<void>;
}

export const SCHEDULING_REPOSITORY = Symbol("SCHEDULING_REPOSITORY");
