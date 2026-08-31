import { Injectable } from "@nestjs/common";
import {
  applySubscriptionAdminAction,
  createContactLog,
  createFollowUp,
  createMonthOverride,
  editCustomerFields,
  getFollowUpById,
  listContactLogs,
  listFollowUps,
  listMonthOverridesForWorkspace,
  listPlatformStaff,
  revokeMonthOverride,
  setWorkspaceAccountStatus,
  updateFollowUp,
  type MonthOverrideRow,
  type PlatformContactLogRow,
  type FollowUpRow,
} from "@academic-precision/database";
import {
  createMonthOverrideRequestSchema,
  createPlatformContactLogRequestSchema,
  createFollowUpRequestSchema,
  customerAccountActionRequestSchema,
  editCustomerRequestSchema,
  subscriptionAdminActionRequestSchema,
  updateFollowUpRequestSchema,
  type CreateFollowUpRequest,
  type FollowUp,
  type ListFollowUpsResponse,
  type ListMonthOverridesResponse,
  type ListPlatformContactLogsResponse,
  type ListPlatformStaffResponse,
  type MonthOverride,
  type PlatformContactLog,
  type PlatformRole,
  type UpdateFollowUpRequest,
} from "@academic-precision/contracts";
import type { z, ZodTypeAny } from "zod";
import { ResourceNotFoundException, ValidationApiException, VersionConflictException } from "../../common/exceptions/api.exception";

/**
 * Platform Operations — Unit 1 write service (Customer Communication +
 * Follow-up). Authorization is enforced at the controller (PlatformAdminGuard
 * + PlatformPermissionGuard); this layer validates input and maps rows to
 * contract DTOs. Every write is audited inside the repository transaction.
 */
@Injectable()
export class PlatformOperationsService {
  // --- Contact logs ---------------------------------------------------------
  async listContactLogs(workspaceId: string, cursor?: string, limit?: number): Promise<ListPlatformContactLogsResponse> {
    const result = await listContactLogs({ workspaceId, cursor, limit });
    return { items: result.items.map(toContactLog), page: { nextCursor: result.nextCursor, hasNext: result.hasNext } };
  }

  async createContactLog(workspaceId: string, actorUserId: string, body: unknown): Promise<PlatformContactLog> {
    const parsed = this.parse(createPlatformContactLogRequestSchema, body);
    const row = await createContactLog({
      workspaceId,
      actorUserId,
      channel: parsed.channel,
      direction: parsed.direction,
      summary: parsed.summary,
      occurredAt: parsed.occurredAt ? new Date(parsed.occurredAt) : undefined,
    });
    return toContactLog(row);
  }

  // --- Follow-ups -----------------------------------------------------------
  async listFollowUps(params: { workspaceId?: string; status?: string; assignedToUserId?: string; cursor?: string; limit?: number }): Promise<ListFollowUpsResponse> {
    const result = await listFollowUps(params);
    return { items: result.items.map(toFollowUp), page: { nextCursor: result.nextCursor, hasNext: result.hasNext } };
  }

  async createFollowUp(workspaceId: string, actorUserId: string, body: unknown): Promise<FollowUp> {
    const parsed: CreateFollowUpRequest = this.parse(createFollowUpRequestSchema, body);
    const { id } = await createFollowUp({
      workspaceId,
      actorUserId,
      title: parsed.title,
      note: parsed.note ?? null,
      dueAt: parsed.dueAt ? new Date(parsed.dueAt) : null,
      assignedToUserId: parsed.assignedToUserId ?? null,
    });
    const row = await getFollowUpById(id);
    if (!row) throw new ResourceNotFoundException();
    return toFollowUp(row);
  }

  async updateFollowUp(id: string, actorUserId: string, body: unknown): Promise<FollowUp> {
    const parsed: UpdateFollowUpRequest = this.parse(updateFollowUpRequestSchema, body);
    const updated = await updateFollowUp({
      id,
      actorUserId,
      status: parsed.status,
      assignedToUserId: parsed.assignedToUserId,
      dueAt: parsed.dueAt !== undefined ? (parsed.dueAt ? new Date(parsed.dueAt) : null) : undefined,
    });
    if (!updated) throw new ResourceNotFoundException();
    const row = await getFollowUpById(id);
    if (!row) throw new ResourceNotFoundException();
    return toFollowUp(row);
  }

  // --- Staff (assignment + role display) ------------------------------------
  async listStaff(): Promise<ListPlatformStaffResponse> {
    const items = await listPlatformStaff();
    return { items: items.map((s) => ({ userId: s.userId, fullName: s.fullName, role: s.role as PlatformRole })) };
  }

  // --- Operating-Month Overrides --------------------------------------------
  async listMonthOverrides(workspaceId: string): Promise<ListMonthOverridesResponse> {
    const items = await listMonthOverridesForWorkspace(workspaceId);
    return { items: items.map(toMonthOverride) };
  }

  async createMonthOverride(workspaceId: string, actorUserId: string, body: unknown): Promise<{ id: string }> {
    const parsed = this.parse(createMonthOverrideRequestSchema, body);
    return createMonthOverride({
      workspaceId,
      actorUserId,
      type: parsed.type,
      reason: parsed.reason,
      expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
    });
  }

  async revokeMonthOverride(overrideId: string, actorUserId: string): Promise<void> {
    const res = await revokeMonthOverride({ overrideId, actorUserId });
    if (!res) throw new ResourceNotFoundException();
  }

  // --- Customer account controls --------------------------------------------
  async accountAction(workspaceId: string, actorUserId: string, body: unknown): Promise<{ status: string }> {
    const parsed = this.parse(customerAccountActionRequestSchema, body);
    const res = await setWorkspaceAccountStatus({ workspaceId, actorUserId, action: parsed.action, reason: parsed.reason });
    if (!res) throw new ResourceNotFoundException();
    return res;
  }

  async editCustomer(workspaceId: string, actorUserId: string, body: unknown): Promise<{ name: string; ownerPhone: string | null }> {
    const parsed = this.parse(editCustomerRequestSchema, body);
    const res = await editCustomerFields({ workspaceId, actorUserId, name: parsed.name, ownerPhone: parsed.ownerPhone, reason: parsed.reason });
    if (!res) throw new ResourceNotFoundException();
    return res;
  }

  // --- Subscription / trial controls ----------------------------------------
  async subscriptionAction(workspaceId: string, actorUserId: string, body: unknown): Promise<{ state: string; periodEnd: string | null }> {
    const parsed = this.parse(subscriptionAdminActionRequestSchema, body);
    const res = await applySubscriptionAdminAction({
      workspaceId,
      actorUserId,
      action: parsed.action,
      reason: parsed.reason,
      days: parsed.days,
      endDate: parsed.endDate ? new Date(parsed.endDate) : undefined,
    });
    if (res === "NO_SUBSCRIPTION") throw new ResourceNotFoundException("لا يوجد اشتراك لهذه المساحة.");
    if (res === "VERSION_CONFLICT") throw new VersionConflictException();
    if (res === "REACTIVATE_NEEDS_PERIOD") {
      // Reactivate never grants time implicitly. An expired subscription has no
      // future period to restore, so ops must set a concrete end date (or
      // extend) first — surfaced as a field-level validation error on `action`.
      throw new ValidationApiException({
        action: ["لا يمكن إعادة التفعيل: انتهت فترة الاشتراك. مدِّد المدة أو حدِّد تاريخ انتهاء جديدًا أولًا."],
      });
    }
    return res;
  }

  private parse<S extends ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
    const result = schema.safeParse(body);
    if (!result.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join(".") || "_";
        (fieldErrors[key] ??= []).push(issue.message);
      }
      throw new ValidationApiException(fieldErrors);
    }
    return result.data;
  }
}

function toContactLog(row: PlatformContactLogRow): PlatformContactLog {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    channel: row.channel as PlatformContactLog["channel"],
    direction: row.direction as PlatformContactLog["direction"],
    summary: row.summary,
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    createdByUserId: row.createdByUserId,
    createdByName: row.createdByName,
  };
}

function toFollowUp(row: FollowUpRow): FollowUp {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
    title: row.title,
    note: row.note,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    status: row.status as FollowUp["status"],
    createdAt: row.createdAt.toISOString(),
    createdByUserId: row.createdByUserId,
    createdByName: row.createdByName,
    assignedToUserId: row.assignedToUserId,
    assignedToName: row.assignedToName,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    resolvedByName: row.resolvedByName,
  };
}

function toMonthOverride(row: MonthOverrideRow): MonthOverride {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    type: row.type as MonthOverride["type"],
    reason: row.reason,
    createdByName: row.createdByName,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    revokedByName: row.revokedByName,
    active: row.active,
  };
}
