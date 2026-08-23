import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type {
  CreateGroupRequest,
  CreateMonthConfirmResponse,
  CreateMonthPreviewRequest,
  CreateMonthPreviewResponse,
  Group,
  GroupMonth,
  GroupMonthApplyChangeResponse,
  GroupMonthChangePreviewRequest,
  GroupMonthChangePreviewResponse,
  ListGroupsResponse,
  ListMonthsResponse,
  ListScheduleRulesResponse,
  ListSessionsResponse,
  OperatingMonth,
  ScheduleApplyResponse,
  SchedulePreviewRequest,
  SchedulePreviewResponse,
  ScheduleRule,
  Session,
  SessionCancelResponse,
  SessionReschedulePreviewRequest,
  SessionReschedulePreviewResponse,
  SessionRescheduleResponse,
  UpdateGroupRequest,
} from "@academic-precision/contracts";
import {
  generateSessionOccurrencesForRules,
  type GroupMonthRow,
  type GroupRow,
  type OperatingMonthRow,
  type ScheduleRuleInput,
  type ScheduleRuleRow,
  type SessionRow,
} from "@academic-precision/database";
import {
  IdempotencyConflictException,
  MonthAlreadyExistsException,
  MonthCreateFailedException,
  ResourceNotFoundException,
  SessionInvalidStateException,
  ValidationApiException,
  VersionConflictException,
} from "../../common/exceptions/api.exception";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import type { WorkspaceContext } from "../../team/api/guards/permission.guard";
import { PermissionResolverService } from "../../team/application/permission-resolver.service";
import { PreviewTokenService } from "./preview-token.service";
import { SCHEDULING_REPOSITORY, type SchedulingRepositoryPort } from "./ports/scheduling-repository.port";

const OWNER_ROLE_LABEL = "OWNER";
const CREATE_MONTH_OPERATION = "CreateMonth";
const CREATE_MONTH_PREVIEW_KIND = "CreateMonth";
const GROUP_MONTH_CHANGE_PREVIEW_KIND = "GroupMonthChange";
const SCHEDULE_PREVIEW_KIND = "Schedule";
const RESCHEDULE_PREVIEW_KIND = "SessionReschedule";
const DEFAULT_LIST_LIMIT = 50;

interface CreateMonthPreviewPayload {
  targetYear: number;
  targetMonth: number;
  groupSpecs: Array<{
    groupId: string;
    groupName: string;
    locationId: string | null;
    baseFeeMinor: number;
    currencyCode: string;
    duePolicy: string;
    dueDay: number | null;
    joinFeePolicy: string;
    scheduleRules: ScheduleRuleInput[];
  }>;
  generatedSessionsEstimate: number;
}

interface GroupMonthChangePreviewPayload {
  groupMonthId: string;
  patch: Partial<{
    locationId: string | null;
    baseFeeMinor: number;
    duePolicy: string;
    dueDay: number | null;
    joinFeePolicy: string;
  }>;
}

interface SchedulePreviewPayload {
  groupMonthId: string;
  rules: ScheduleRuleInput[];
}

interface ReschedulePreviewPayload {
  sessionId: string;
  scheduledAt: string;
  durationMinutes: number;
}

/**
 * Application service for Phase 3 Months/Groups/GroupMonth/Schedule/
 * Sessions endpoints. Controllers stay thin; all authorization/business
 * rules live here, mirroring the Phase 1/2 `TeamService` convention.
 */
@Injectable()
export class SchedulingService {
  constructor(
    @Inject(SCHEDULING_REPOSITORY) private readonly repository: SchedulingRepositoryPort,
    private readonly permissionResolver: PermissionResolverService,
    private readonly previewTokens: PreviewTokenService,
  ) {}

  // ---------------------------------------------------------------------
  // Groups
  // ---------------------------------------------------------------------

  async listGroups(authUser: VerifiedSupabaseToken, workspaceContext: WorkspaceContext): Promise<ListGroupsResponse> {
    const all = await this.repository.listGroups(workspaceContext.workspaceId);
    const grant = await this.permissionResolver.hasPermission(
      workspaceContext.workspaceId,
      authUser.id,
      "groups.view",
    );
    const visible =
      !grant || grant.scope === "ALL_GROUPS"
        ? all
        : all.filter((g) => (grant.groupIds ?? []).includes(g.id));
    return { groups: visible.map((g) => this.toGroupDto(g)) };
  }

  async createGroup(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    body: CreateGroupRequest,
    correlationId: string | null,
  ): Promise<Group> {
    const created = await this.repository.insertGroup({
      workspaceId: workspaceContext.workspaceId,
      name: body.name,
      subject: body.subject ?? null,
      grade: body.grade ?? null,
      defaultLocationId: body.defaultLocationId ?? null,
    });

    await this.repository.insertAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      actorUserId: authUser.id,
      actorMembershipId: workspaceContext.membership.id,
      action: "group.created",
      entityType: "group",
      entityId: created.id,
      afterJson: this.toGroupDto(created),
      correlationId,
    });

    return this.toGroupDto(created);
  }

  async getGroup(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    groupId: string,
  ): Promise<Group> {
    const group = await this.loadGroupInScope(authUser, workspaceContext, groupId, "groups.view");
    return this.toGroupDto(group);
  }

  async updateGroup(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    groupId: string,
    body: UpdateGroupRequest,
    correlationId: string | null,
  ): Promise<Group> {
    const before = await this.loadGroupInScope(authUser, workspaceContext, groupId, "groups.manage");

    const updated = await this.repository.updateGroupWithVersion(groupId, body.version, {
      name: body.name,
      subject: body.subject,
      grade: body.grade,
      defaultLocationId: body.defaultLocationId,
      status: body.status,
    });
    if (!updated) {
      throw new VersionConflictException(undefined, { currentVersion: before.version });
    }

    await this.repository.insertAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      actorUserId: authUser.id,
      actorMembershipId: workspaceContext.membership.id,
      action: "group.updated",
      entityType: "group",
      entityId: updated.id,
      beforeJson: this.toGroupDto(before),
      afterJson: this.toGroupDto(updated),
      correlationId,
    });

    return this.toGroupDto(updated);
  }

  // ---------------------------------------------------------------------
  // Months
  // ---------------------------------------------------------------------

  async listMonths(workspaceContext: WorkspaceContext): Promise<ListMonthsResponse> {
    const rows = await this.repository.listOperatingMonths(workspaceContext.workspaceId);
    return { months: rows.map((m) => this.toMonthDto(m)) };
  }

  async getMonth(workspaceContext: WorkspaceContext, id: string): Promise<OperatingMonth> {
    const month = await this.repository.findOperatingMonthById(id);
    if (!month || month.workspaceId !== workspaceContext.workspaceId) {
      throw new ResourceNotFoundException();
    }
    return this.toMonthDto(month);
  }

  private assertOwner(workspaceContext: WorkspaceContext): void {
    if (workspaceContext.membership.roleLabel !== OWNER_ROLE_LABEL) {
      throw new ResourceNotFoundException();
    }
  }

  async previewCreateMonth(
    workspaceContext: WorkspaceContext,
    body: CreateMonthPreviewRequest,
  ): Promise<CreateMonthPreviewResponse> {
    this.assertOwner(workspaceContext);

    const existing = await this.repository.findOperatingMonthByYearMonth(
      workspaceContext.workspaceId,
      body.targetYear,
      body.targetMonth,
    );
    if (existing) {
      throw new MonthAlreadyExistsException(undefined, { monthId: existing.id });
    }

    const workspaceTimezone = await this.repository.findWorkspaceTimezone(workspaceContext.workspaceId);
    if (!workspaceTimezone) {
      throw new MonthCreateFailedException("تعذر تحديد المنطقة الزمنية لمساحة العمل.");
    }

    const groupSpecs: CreateMonthPreviewPayload["groupSpecs"] = [];

    if (body.sourceMonthId) {
      const sourceMonth = await this.repository.findOperatingMonthById(body.sourceMonthId);
      if (!sourceMonth || sourceMonth.workspaceId !== workspaceContext.workspaceId) {
        throw new MonthCreateFailedException("شهر المصدر غير موجود أو لا ينتمي لمساحة العمل.");
      }
      const sourceGroupMonths = await this.repository.listGroupMonthsForOperatingMonth(sourceMonth.id);
      for (const gm of sourceGroupMonths) {
        const group = await this.repository.findGroupById(gm.groupId);
        if (!group || group.status !== "ACTIVE") continue;
        const rules = await this.repository.listScheduleRulesForGroupMonth(gm.id);
        groupSpecs.push({
          groupId: gm.groupId,
          groupName: group.name,
          locationId: gm.locationId,
          baseFeeMinor: gm.baseFeeMinor,
          currencyCode: gm.currencyCode,
          duePolicy: gm.duePolicy,
          dueDay: gm.dueDay,
          joinFeePolicy: gm.joinFeePolicy,
          scheduleRules: rules.map((r) => this.toScheduleRuleInput(r)),
        });
      }
    } else if (body.selectedGroupIds && body.selectedGroupIds.length > 0) {
      for (const groupId of body.selectedGroupIds) {
        const group = await this.repository.findGroupById(groupId);
        if (!group || group.workspaceId !== workspaceContext.workspaceId || group.status !== "ACTIVE") {
          throw new ValidationApiException({ selectedGroupIds: [`المجموعة ${groupId} غير صالحة.`] });
        }
        const config = body.groupInitialConfig?.[groupId];
        if (!config) {
          throw new ValidationApiException({
            groupInitialConfig: [`يجب توفير إعدادات أولية (رسوم/جدول) للمجموعة الجديدة ${groupId}.`],
          });
        }
        groupSpecs.push({
          groupId,
          groupName: group.name,
          locationId: config.locationId ?? null,
          baseFeeMinor: config.baseFeeMinor,
          currencyCode: config.currencyCode,
          duePolicy: config.duePolicy,
          dueDay: config.dueDay ?? null,
          joinFeePolicy: config.joinFeePolicy,
          scheduleRules: config.scheduleRules,
        });
      }
    } else {
      throw new ValidationApiException({
        _root: ["يجب تحديد sourceMonthId أو selectedGroupIds."],
      });
    }

    const generatedSessionsEstimate = groupSpecs.reduce((sum, spec) => {
      return (
        sum +
        this.estimateOccurrenceCount({
          workspaceTimezone,
          year: body.targetYear,
          month: body.targetMonth,
          rules: spec.scheduleRules,
        })
      );
    }, 0);

    const { token, expiresAt } = this.previewTokens.issue<CreateMonthPreviewPayload>(
      CREATE_MONTH_PREVIEW_KIND,
      workspaceContext.workspaceId,
      { targetYear: body.targetYear, targetMonth: body.targetMonth, groupSpecs, generatedSessionsEstimate },
    );

    return {
      previewToken: token,
      groups: groupSpecs.map((s) => ({ groupId: s.groupId, name: s.groupName })),
      generatedSessions: generatedSessionsEstimate,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async confirmCreateMonth(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    idempotencyKey: string | null,
    body: { previewToken: string },
    correlationId: string | null,
  ): Promise<CreateMonthConfirmResponse> {
    this.assertOwner(workspaceContext);
    if (!idempotencyKey) {
      throw new ValidationApiException({ "Idempotency-Key": ["مطلوب لإنشاء شهر جديد."] });
    }

    const requestHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");

    const existingRecord = await this.repository.findIdempotencyRecord(
      workspaceContext.workspaceId,
      CREATE_MONTH_OPERATION,
      idempotencyKey,
    );
    if (existingRecord) {
      if (existingRecord.requestHash !== requestHash) {
        throw new IdempotencyConflictException();
      }
      if (existingRecord.status === "COMPLETED" && existingRecord.responsePayload) {
        return existingRecord.responsePayload as CreateMonthConfirmResponse;
      }
      // IN_PROGRESS/FAILED_RETRYABLE with a matching payload: fall through
      // and let the transaction's own MONTH_ALREADY_EXISTS re-check guard
      // against a genuine double-create; a stuck IN_PROGRESS row from a
      // crashed prior attempt is intentionally retryable here.
    }

    const plan = this.previewTokens.consume<CreateMonthPreviewPayload>(
      CREATE_MONTH_PREVIEW_KIND,
      workspaceContext.workspaceId,
      body.previewToken,
    );

    const workspaceTimezone = await this.repository.findWorkspaceTimezone(workspaceContext.workspaceId);
    if (!workspaceTimezone) {
      throw new MonthCreateFailedException("تعذر تحديد المنطقة الزمنية لمساحة العمل.");
    }

    const idempotencyRow =
      existingRecord ??
      (await this.repository.tryInsertIdempotencyRecord({
        workspaceId: workspaceContext.workspaceId,
        operation: CREATE_MONTH_OPERATION,
        key: idempotencyKey,
        requestHash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })) ??
      (await this.repository.findIdempotencyRecord(workspaceContext.workspaceId, CREATE_MONTH_OPERATION, idempotencyKey));

    if (!idempotencyRow) {
      throw new MonthCreateFailedException("تعذر تسجيل مفتاح idempotency.");
    }
    if (idempotencyRow.requestHash !== requestHash) {
      throw new IdempotencyConflictException();
    }
    if (idempotencyRow.status === "COMPLETED" && idempotencyRow.responsePayload) {
      return idempotencyRow.responsePayload as CreateMonthConfirmResponse;
    }

    const result = await this.repository.runCreateMonthTransaction({
      workspaceId: workspaceContext.workspaceId,
      workspaceTimezone,
      targetYear: plan.targetYear,
      targetMonth: plan.targetMonth,
      createdByUserId: authUser.id,
      groupSpecs: plan.groupSpecs.map((spec) => ({
        groupId: spec.groupId,
        locationId: spec.locationId,
        baseFeeMinor: spec.baseFeeMinor,
        currencyCode: spec.currencyCode,
        duePolicy: spec.duePolicy,
        dueDay: spec.dueDay,
        joinFeePolicy: spec.joinFeePolicy,
        scheduleRules: spec.scheduleRules,
      })),
    });

    if (result === "MONTH_ALREADY_EXISTS") {
      await this.repository.failIdempotencyRecord(idempotencyRow.id);
      throw new MonthAlreadyExistsException();
    }

    const response: CreateMonthConfirmResponse = {
      monthId: result.operatingMonth.id,
      status: "CURRENT",
      groupMonthCount: result.groupMonths.length,
      sessionCount: result.sessionCount,
    };

    await this.repository.insertAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      actorUserId: authUser.id,
      actorMembershipId: workspaceContext.membership.id,
      action: "month.created",
      entityType: "operating_month",
      entityId: result.operatingMonth.id,
      afterJson: response,
      correlationId,
    });

    await this.repository.completeIdempotencyRecord(idempotencyRow.id, 201, response);

    return response;
  }

  // ---------------------------------------------------------------------
  // GroupMonth
  // ---------------------------------------------------------------------

  async getGroupMonth(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    id: string,
  ): Promise<GroupMonth> {
    const { groupMonth } = await this.loadGroupMonthInScope(authUser, workspaceContext, id, "groups.view");
    return this.toGroupMonthDto(groupMonth);
  }

  async previewGroupMonthChange(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    id: string,
    body: GroupMonthChangePreviewRequest,
  ): Promise<GroupMonthChangePreviewResponse> {
    const { groupMonth } = await this.loadGroupMonthInScope(authUser, workspaceContext, id, "groups.manage");

    const diff: GroupMonthChangePreviewResponse["diff"] = [];
    const patch: GroupMonthChangePreviewPayload["patch"] = {};

    if (body.locationId !== undefined && body.locationId !== groupMonth.locationId) {
      diff.push({ field: "locationId", before: groupMonth.locationId, after: body.locationId });
      patch.locationId = body.locationId;
    }
    if (body.baseFeeMinor !== undefined && body.baseFeeMinor !== groupMonth.baseFeeMinor) {
      diff.push({ field: "baseFeeMinor", before: groupMonth.baseFeeMinor, after: body.baseFeeMinor });
      patch.baseFeeMinor = body.baseFeeMinor;
    }
    if (body.duePolicy !== undefined && body.duePolicy !== groupMonth.duePolicy) {
      diff.push({ field: "duePolicy", before: groupMonth.duePolicy, after: body.duePolicy });
      patch.duePolicy = body.duePolicy;
    }
    if (body.dueDay !== undefined && body.dueDay !== groupMonth.dueDay) {
      diff.push({ field: "dueDay", before: groupMonth.dueDay, after: body.dueDay });
      patch.dueDay = body.dueDay;
    }
    if (body.joinFeePolicy !== undefined && body.joinFeePolicy !== groupMonth.joinFeePolicy) {
      diff.push({ field: "joinFeePolicy", before: groupMonth.joinFeePolicy, after: body.joinFeePolicy });
      patch.joinFeePolicy = body.joinFeePolicy;
    }

    const { token, expiresAt } = this.previewTokens.issue<GroupMonthChangePreviewPayload>(
      GROUP_MONTH_CHANGE_PREVIEW_KIND,
      workspaceContext.workspaceId,
      { groupMonthId: groupMonth.id, patch },
    );

    return { previewToken: token, currentVersion: groupMonth.version, diff, expiresAt: expiresAt.toISOString() };
  }

  async applyGroupMonthChange(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    id: string,
    body: { previewToken: string; expectedVersion: number },
    correlationId: string | null,
  ): Promise<GroupMonthApplyChangeResponse> {
    const { groupMonth: before } = await this.loadGroupMonthInScope(authUser, workspaceContext, id, "groups.manage");

    const plan = this.previewTokens.consume<GroupMonthChangePreviewPayload>(
      GROUP_MONTH_CHANGE_PREVIEW_KIND,
      workspaceContext.workspaceId,
      body.previewToken,
    );
    if (plan.groupMonthId !== id) {
      throw new ValidationApiException({ previewToken: ["رمز المعاينة لا يخص هذا السجل."] });
    }

    const updated = await this.repository.updateGroupMonthWithVersion(id, body.expectedVersion, plan.patch);
    if (!updated) {
      throw new VersionConflictException(undefined, { currentVersion: before.version });
    }

    await this.repository.insertAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      actorUserId: authUser.id,
      actorMembershipId: workspaceContext.membership.id,
      action: "group_month.updated",
      entityType: "group_month",
      entityId: updated.id,
      beforeJson: this.toGroupMonthDto(before),
      afterJson: this.toGroupMonthDto(updated),
      correlationId,
    });

    return { groupMonth: this.toGroupMonthDto(updated) };
  }

  // ---------------------------------------------------------------------
  // Schedule
  // ---------------------------------------------------------------------

  async listScheduleRules(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    groupMonthId: string,
  ): Promise<ListScheduleRulesResponse> {
    await this.loadGroupMonthInScope(authUser, workspaceContext, groupMonthId, "groups.view");
    const rules = await this.repository.listScheduleRulesForGroupMonth(groupMonthId);
    return { rules: rules.map((r) => this.toScheduleRuleDto(r)) };
  }

  async previewSchedule(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    groupMonthId: string,
    body: SchedulePreviewRequest,
  ): Promise<SchedulePreviewResponse> {
    const { groupMonth, month } = await this.loadGroupMonthInScope(
      authUser,
      workspaceContext,
      groupMonthId,
      "sessions.manage",
    );
    const workspaceTimezone = await this.repository.findWorkspaceTimezone(workspaceContext.workspaceId);
    if (!workspaceTimezone) {
      throw new ValidationApiException({ _root: ["تعذر تحديد المنطقة الزمنية لمساحة العمل."] });
    }

    const now = new Date();
    const existingSessions = await this.repository.listSessions({
      workspaceId: workspaceContext.workspaceId,
      groupMonthId,
      limit: 1000,
    });
    const futureScheduled = existingSessions.filter((s) => s.status === "SCHEDULED" && s.scheduledAt > now);

    const proposedOccurrences = generateSessionOccurrencesForRules({
      workspaceTimezone,
      year: month.year,
      month: month.month,
      rules: body.rules,
    }).filter((o) => o.scheduledAt > now);

    const proposedTimes = new Set(proposedOccurrences.map((o) => o.scheduledAt.getTime()));
    const existingTimes = new Set(futureScheduled.map((s) => s.scheduledAt.getTime()));

    const toAdd = proposedOccurrences
      .filter((o) => !existingTimes.has(o.scheduledAt.getTime()))
      .map((o) => ({ scheduledAt: o.scheduledAt.toISOString(), durationMinutes: o.durationMinutes }));
    const toRemove = futureScheduled
      .filter((s) => !proposedTimes.has(s.scheduledAt.getTime()))
      .map((s) => ({ sessionId: s.id, scheduledAt: s.scheduledAt.toISOString() }));
    const unchanged = futureScheduled
      .filter((s) => proposedTimes.has(s.scheduledAt.getTime()))
      .map((s) => ({ sessionId: s.id, scheduledAt: s.scheduledAt.toISOString() }));

    const { token, expiresAt } = this.previewTokens.issue<SchedulePreviewPayload>(
      SCHEDULE_PREVIEW_KIND,
      workspaceContext.workspaceId,
      { groupMonthId: groupMonth.id, rules: body.rules },
    );

    return { previewToken: token, toAdd, toRemove, unchanged, expiresAt: expiresAt.toISOString() };
  }

  async applySchedule(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    groupMonthId: string,
    body: { previewToken: string },
    correlationId: string | null,
  ): Promise<ScheduleApplyResponse> {
    const { groupMonth, month } = await this.loadGroupMonthInScope(
      authUser,
      workspaceContext,
      groupMonthId,
      "sessions.manage",
    );
    const plan = this.previewTokens.consume<SchedulePreviewPayload>(
      SCHEDULE_PREVIEW_KIND,
      workspaceContext.workspaceId,
      body.previewToken,
    );
    if (plan.groupMonthId !== groupMonthId) {
      throw new ValidationApiException({ previewToken: ["رمز المعاينة لا يخص هذا السجل."] });
    }

    const workspaceTimezone = await this.repository.findWorkspaceTimezone(workspaceContext.workspaceId);
    if (!workspaceTimezone) {
      throw new ValidationApiException({ _root: ["تعذر تحديد المنطقة الزمنية لمساحة العمل."] });
    }

    const result = await this.repository.applyScheduleChangeTransaction({
      groupMonthId,
      workspaceId: workspaceContext.workspaceId,
      workspaceTimezone,
      targetYear: month.year,
      targetMonth: month.month,
      newRules: plan.rules,
      createdByUserId: authUser.id,
      now: new Date(),
    });

    await this.repository.insertAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      actorUserId: authUser.id,
      actorMembershipId: workspaceContext.membership.id,
      action: "group_month.schedule_changed",
      entityType: "group_month",
      entityId: groupMonth.id,
      afterJson: {
        cancelledSessionIds: result.cancelledSessionIds,
        createdSessionIds: result.createdSessions.map((s) => s.id),
      },
      correlationId,
    });

    return {
      rules: result.scheduleRules.map((r) => this.toScheduleRuleDto(r)),
      cancelledSessionIds: result.cancelledSessionIds,
      createdSessionIds: result.createdSessions.map((s) => s.id),
    };
  }

  // ---------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------

  async listSessions(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    query: { groupMonthId?: string; status?: string; from?: string; to?: string; cursor?: string; limit?: number },
  ): Promise<ListSessionsResponse> {
    const grant = await this.permissionResolver.hasPermission(
      workspaceContext.workspaceId,
      authUser.id,
      "groups.view",
    );

    if (query.groupMonthId) {
      await this.loadGroupMonthInScope(authUser, workspaceContext, query.groupMonthId, "groups.view");
    } else if (!grant || grant.scope !== "ALL_GROUPS") {
      // Scoped (non-Owner) callers listing without a groupMonthId filter:
      // require an explicit groupMonthId to avoid a cross-group leak, since
      // scope is expressed per-group and sessions don't carry a direct
      // group id column (only group_month_id). Documented simplification —
      // see Phase 3 handoff DEVIATIONS.
      throw new ValidationApiException({ groupMonthId: ["مطلوب لتحديد الحصص ضمن نطاق صلاحياتك."] });
    }

    const limit = Math.min(query.limit ?? DEFAULT_LIST_LIMIT, 200);
    let cursorScheduledAt: Date | undefined;
    let cursorId: string | undefined;
    if (query.cursor) {
      const decoded = this.decodeCursor(query.cursor);
      cursorScheduledAt = decoded?.scheduledAt;
      cursorId = decoded?.id;
    }

    const rows = await this.repository.listSessions({
      workspaceId: workspaceContext.workspaceId,
      groupMonthId: query.groupMonthId,
      status: query.status,
      scheduledFrom: query.from ? new Date(query.from) : undefined,
      scheduledTo: query.to ? new Date(query.to) : undefined,
      limit: limit + 1,
      cursorScheduledAt,
      cursorId,
    });

    const hasNext = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];

    return {
      items: items.map((s) => this.toSessionDto(s)),
      page: {
        hasNext,
        nextCursor: hasNext && last ? this.encodeCursor(last.scheduledAt, last.id) : null,
      },
    };
  }

  async getSession(authUser: VerifiedSupabaseToken, workspaceContext: WorkspaceContext, id: string): Promise<Session> {
    const { session } = await this.loadSessionInScope(authUser, workspaceContext, id, "groups.view");
    return this.toSessionDto(session);
  }

  async cancelSession(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    id: string,
    correlationId: string | null,
  ): Promise<SessionCancelResponse> {
    const { session: before } = await this.loadSessionInScope(authUser, workspaceContext, id, "sessions.manage");
    if (before.status !== "SCHEDULED") {
      throw new SessionInvalidStateException(undefined, { currentStatus: before.status });
    }

    const updated = await this.repository.cancelSessionIfScheduled(id);
    if (!updated) {
      throw new SessionInvalidStateException(undefined, { currentStatus: before.status });
    }

    await this.repository.insertAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      actorUserId: authUser.id,
      actorMembershipId: workspaceContext.membership.id,
      action: "session.cancelled",
      entityType: "session",
      entityId: updated.id,
      beforeJson: this.toSessionDto(before),
      afterJson: this.toSessionDto(updated),
      correlationId,
    });

    return { session: this.toSessionDto(updated) };
  }

  async reschedulePreviewSession(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    id: string,
    body: SessionReschedulePreviewRequest,
  ): Promise<SessionReschedulePreviewResponse> {
    const { session } = await this.loadSessionInScope(authUser, workspaceContext, id, "sessions.manage");
    if (session.status !== "SCHEDULED") {
      throw new SessionInvalidStateException(undefined, { currentStatus: session.status });
    }

    const { token, expiresAt } = this.previewTokens.issue<ReschedulePreviewPayload>(
      RESCHEDULE_PREVIEW_KIND,
      workspaceContext.workspaceId,
      { sessionId: id, scheduledAt: body.scheduledAt, durationMinutes: body.durationMinutes },
    );

    return {
      previewToken: token,
      proposed: { scheduledAt: body.scheduledAt, durationMinutes: body.durationMinutes },
      expiresAt: expiresAt.toISOString(),
    };
  }

  async rescheduleSession(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    id: string,
    body: { previewToken: string },
    correlationId: string | null,
  ): Promise<SessionRescheduleResponse> {
    await this.loadSessionInScope(authUser, workspaceContext, id, "sessions.manage");

    const plan = this.previewTokens.consume<ReschedulePreviewPayload>(
      RESCHEDULE_PREVIEW_KIND,
      workspaceContext.workspaceId,
      body.previewToken,
    );
    if (plan.sessionId !== id) {
      throw new ValidationApiException({ previewToken: ["رمز المعاينة لا يخص هذه الحصة."] });
    }

    const result = await this.repository.rescheduleSessionTransaction({
      originalSessionId: id,
      newScheduledAt: new Date(plan.scheduledAt),
      newDurationMinutes: plan.durationMinutes,
      createdByUserId: authUser.id,
    });
    if (!result) {
      throw new SessionInvalidStateException(
        undefined,
        { reason: "Session is not SCHEDULED, or already has a replacement." },
      );
    }

    await this.repository.insertAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      actorUserId: authUser.id,
      actorMembershipId: workspaceContext.membership.id,
      action: "session.rescheduled",
      entityType: "session",
      entityId: result.original.id,
      beforeJson: { status: "SCHEDULED" },
      afterJson: {
        original: this.toSessionDto(result.original),
        replacement: this.toSessionDto(result.replacement),
      },
      correlationId,
    });

    return { original: this.toSessionDto(result.original), replacement: this.toSessionDto(result.replacement) };
  }

  // ---------------------------------------------------------------------
  // Scope helpers
  // ---------------------------------------------------------------------

  private async loadGroupInScope(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    groupId: string,
    permission: "groups.view" | "groups.manage",
  ): Promise<GroupRow> {
    const group = await this.repository.findGroupById(groupId);
    if (!group || group.workspaceId !== workspaceContext.workspaceId) {
      throw new ResourceNotFoundException();
    }
    const inScope = await this.permissionResolver.isGroupInScope(
      workspaceContext.workspaceId,
      authUser.id,
      permission,
      groupId,
    );
    if (!inScope) {
      throw new ResourceNotFoundException();
    }
    return group;
  }

  private async loadGroupMonthInScope(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    groupMonthId: string,
    permission: "groups.view" | "groups.manage" | "sessions.manage",
  ): Promise<{ groupMonth: GroupMonthRow; month: OperatingMonthRow }> {
    const groupMonth = await this.repository.findGroupMonthById(groupMonthId);
    if (!groupMonth || groupMonth.workspaceId !== workspaceContext.workspaceId) {
      throw new ResourceNotFoundException();
    }
    const inScope = await this.permissionResolver.isGroupInScope(
      workspaceContext.workspaceId,
      authUser.id,
      permission,
      groupMonth.groupId,
    );
    if (!inScope) {
      throw new ResourceNotFoundException();
    }
    const month = await this.repository.findOperatingMonthById(groupMonth.operatingMonthId);
    if (!month) {
      throw new ResourceNotFoundException();
    }
    return { groupMonth, month };
  }

  private async loadSessionInScope(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    sessionId: string,
    permission: "groups.view" | "sessions.manage",
  ): Promise<{ session: SessionRow }> {
    const session = await this.repository.findSessionById(sessionId);
    if (!session || session.workspaceId !== workspaceContext.workspaceId) {
      throw new ResourceNotFoundException();
    }
    const groupMonth = await this.repository.findGroupMonthById(session.groupMonthId);
    if (!groupMonth) {
      throw new ResourceNotFoundException();
    }
    const inScope = await this.permissionResolver.isGroupInScope(
      workspaceContext.workspaceId,
      authUser.id,
      permission,
      groupMonth.groupId,
    );
    if (!inScope) {
      throw new ResourceNotFoundException();
    }
    return { session };
  }

  // ---------------------------------------------------------------------
  // DTO mappers
  // ---------------------------------------------------------------------

  private toGroupDto(row: GroupRow): Group {
    return {
      id: row.id,
      name: row.name,
      subject: row.subject,
      grade: row.grade,
      defaultLocationId: row.defaultLocationId,
      status: row.status as Group["status"],
      version: row.version,
    };
  }

  private toMonthDto(row: OperatingMonthRow): OperatingMonth {
    return {
      id: row.id,
      year: row.year,
      month: row.month,
      status: row.status as OperatingMonth["status"],
      version: row.version,
    };
  }

  private toGroupMonthDto(row: GroupMonthRow): GroupMonth {
    return {
      id: row.id,
      groupId: row.groupId,
      operatingMonthId: row.operatingMonthId,
      locationId: row.locationId,
      baseFeeMinor: row.baseFeeMinor,
      currencyCode: row.currencyCode,
      duePolicy: row.duePolicy as GroupMonth["duePolicy"],
      dueDay: row.dueDay,
      joinFeePolicy: row.joinFeePolicy as GroupMonth["joinFeePolicy"],
      monthlyStatus: row.monthlyStatus as GroupMonth["monthlyStatus"],
      version: row.version,
    };
  }

  private toScheduleRuleDto(row: ScheduleRuleRow): ScheduleRule {
    return {
      id: row.id,
      weekday: row.weekday,
      startTime: row.startTime,
      durationMinutes: row.durationMinutes,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
    };
  }

  private toScheduleRuleInput(row: ScheduleRuleRow): ScheduleRuleInput {
    return {
      weekday: row.weekday,
      startTime: row.startTime,
      durationMinutes: row.durationMinutes,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
    };
  }

  private toSessionDto(row: SessionRow): Session {
    return {
      id: row.id,
      groupMonthId: row.groupMonthId,
      scheduledAt: row.scheduledAt.toISOString(),
      durationMinutes: row.durationMinutes,
      status: row.status as Session["status"],
      origin: row.origin as Session["origin"],
      rescheduledFromSessionId: row.rescheduledFromSessionId,
      billableForProration: row.billableForProration,
      version: row.version,
    };
  }

  private estimateOccurrenceCount(params: {
    workspaceTimezone: string;
    year: number;
    month: number;
    rules: ScheduleRuleInput[];
  }): number {
    return generateSessionOccurrencesForRules({
      workspaceTimezone: params.workspaceTimezone,
      year: params.year,
      month: params.month,
      rules: params.rules,
    }).length;
  }

  private encodeCursor(scheduledAt: Date, id: string): string {
    return Buffer.from(`${scheduledAt.toISOString()}|${id}`, "utf8").toString("base64url");
  }

  private decodeCursor(cursor: string): { scheduledAt: Date; id: string } | undefined {
    try {
      const decoded = Buffer.from(cursor, "base64url").toString("utf8");
      const [iso, id] = decoded.split("|");
      if (!iso || !id) return undefined;
      return { scheduledAt: new Date(iso), id };
    } catch {
      return undefined;
    }
  }
}
