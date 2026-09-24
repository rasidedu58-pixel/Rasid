import { Injectable } from "@nestjs/common";
import {
  getPlatformLeadMetrics,
  listPlatformLeads,
  updatePlatformLead,
  type PlatformLeadRow,
} from "@academic-precision/database";
import {
  updatePlatformLeadRequestSchema,
  type ListPlatformLeadsResponse,
  type PlatformLead,
  type PlatformLeadFilter,
  type PlatformLeadMetrics,
} from "@academic-precision/contracts";
import type { ZodTypeAny, z } from "zod";
import { ResourceNotFoundException, ValidationApiException } from "../../common/exceptions/api.exception";

/**
 * Platform Leads — Phase 16 Part B read/write service. Authorization is
 * enforced at the controller (PlatformAdminGuard + PlatformPermissionGuard);
 * this layer maps the named UI filter to repository params, maps rows to
 * contract DTOs (Dates → ISO strings, derived subscription hint), and
 * validates the update body. Every write is audited inside the repository
 * transaction.
 */
@Injectable()
export class PlatformLeadsService {
  async listLeads(params: { filter?: string; search?: string; limit?: number }): Promise<ListPlatformLeadsResponse> {
    const repoParams = mapFilter(params.filter);
    const { items, hasNext } = await listPlatformLeads({ ...repoParams, search: params.search, limit: params.limit });
    return { items: items.map(toLead), page: { nextCursor: null, hasNext } };
  }

  async getMetrics(): Promise<PlatformLeadMetrics> {
    return getPlatformLeadMetrics();
  }

  async updateLead(id: string, actorUserId: string, body: unknown): Promise<PlatformLead> {
    const parsed = this.parse(updatePlatformLeadRequestSchema, body);
    const row = await updatePlatformLead({
      id,
      actorUserId,
      status: parsed.status,
      note: parsed.note,
      nextFollowUpAt:
        parsed.nextFollowUpAt === undefined ? undefined : parsed.nextFollowUpAt === null ? null : new Date(parsed.nextFollowUpAt),
      markContactedNow: parsed.markContactedNow,
    });
    if (!row) throw new ResourceNotFoundException();
    return toLead(row);
  }

  private parse<T extends ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
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

/** Translate the small named UI filter into repository query params. */
function mapFilter(filter: string | undefined): { statuses?: string[]; needsFollowUp?: boolean } {
  switch (filter as PlatformLeadFilter | undefined) {
    case "NEW":
      return { statuses: ["NEW"] };
    case "NEEDS_FOLLOW_UP":
      return { needsFollowUp: true };
    case "POSTPONED":
      return { statuses: ["POSTPONED"] };
    case "CONTACTED":
      return { statuses: ["CONTACTED"] };
    case "CONVERTED":
      return { statuses: ["CONVERTED"] };
    case "ALL":
    default:
      return {};
  }
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function toLead(row: PlatformLeadRow): PlatformLead {
  const hasActivePaidSubscription = row.subscriptionState === "ACTIVE" && !!row.subscriptionPlanCode;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
    ownerUserId: row.ownerUserId,
    ownerName: row.ownerName,
    ownerPhone: row.ownerPhone,
    ownerEmail: row.ownerEmail,
    status: row.status as PlatformLead["status"],
    lastContactAt: iso(row.lastContactAt),
    nextFollowUpAt: iso(row.nextFollowUpAt),
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    updatedByName: row.updatedByName,
    subscriptionState: row.subscriptionState,
    trialEndsAt: iso(row.trialEndsAt),
    hasActivePaidSubscription,
  };
}
