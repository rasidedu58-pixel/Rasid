import { Inject, Injectable } from "@nestjs/common";
import type { ActionCenterResponse } from "@academic-precision/contracts";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import type { WorkspaceContext } from "../../team/api/guards/permission.guard";
import { PermissionResolverService } from "../../team/application/permission-resolver.service";
import { FINANCE_REPOSITORY, type FinanceRepositoryPort } from "../../finance/application/ports/finance-repository.port";
import { ATTENTION_REPOSITORY, type AttentionRepositoryPort } from "../../attention/application/ports/attention-repository.port";
import { BILLING_REPOSITORY, type BillingRepositoryPort } from "../../billing/application/ports/billing-repository.port";
import { ACTION_CENTER_REPOSITORY, type ActionCenterRepositoryPort } from "./ports/action-center-repository.port";

const OWNER_ROLE_LABEL = "OWNER";
const SECTION_ITEM_LIMIT = 10;
const SUBSCRIPTION_WARNING_STATES = new Set(["TRIAL", "EXPIRING", "EXPIRED", "PAYMENT_FAILED"]);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Application service for `GET /action-center` — Phase 9.
 *
 * Phase 9 Closure correction #5: every section below is gated by its OWN
 * permission check, independent of the others. A caller lacking a
 * section's permission simply never has that key set on the response
 * object at all (not `null`, not a zeroed count) — `undefined` in the
 * response DTO is dropped by JSON serialization, so the shape itself never
 * reveals "this section exists but you can't see it".
 */
@Injectable()
export class ActionCenterService {
  constructor(
    private readonly permissionResolver: PermissionResolverService,
    @Inject(ACTION_CENTER_REPOSITORY) private readonly repository: ActionCenterRepositoryPort,
    @Inject(FINANCE_REPOSITORY) private readonly financeRepository: FinanceRepositoryPort,
    @Inject(ATTENTION_REPOSITORY) private readonly attentionRepository: AttentionRepositoryPort,
    @Inject(BILLING_REPOSITORY) private readonly billingRepository: BillingRepositoryPort,
  ) {}

  async getActionCenter(authUser: VerifiedSupabaseToken, workspaceContext: WorkspaceContext): Promise<ActionCenterResponse> {
    const workspaceId = workspaceContext.workspaceId;
    const now = new Date();

    const [month, attentionSection, followUpsSection, missingRecordsSection, collectionSection, subscriptionWarning, nextSession] = await Promise.all([
      this.repository.getCurrentMonth(workspaceId),
      this.buildAttentionSection(authUser, workspaceContext),
      this.buildFollowUpsSection(authUser, workspaceContext, now),
      this.buildMissingRecordsSection(authUser, workspaceContext),
      this.buildCollectionSection(authUser, workspaceContext),
      this.buildSubscriptionWarning(workspaceContext),
      this.buildNextSession(authUser, workspaceContext, now),
    ]);

    return {
      month: month ?? null,
      nextSession: nextSession ?? undefined,
      attention: attentionSection,
      followUpsDue: followUpsSection,
      missingRecords: missingRecordsSection,
      collection: collectionSection,
      subscriptionWarning: subscriptionWarning ?? undefined,
      asOf: now.toISOString(),
    };
  }

  // ---------------------------------------------------------------------
  // Attention → followup.read
  // ---------------------------------------------------------------------

  private async buildAttentionSection(authUser: VerifiedSupabaseToken, workspaceContext: WorkspaceContext) {
    const grant = await this.permissionResolver.hasPermission(workspaceContext.workspaceId, authUser.id, "followup.read");
    if (!grant) return undefined;
    const restrictToGroupIds = grant.scope === "ALL_GROUPS" ? undefined : (grant.groupIds ?? []);
    const cases = await this.attentionRepository.listAttentionCasesForWorkspace({ workspaceId: workspaceContext.workspaceId, restrictToGroupIds, limit: SECTION_ITEM_LIMIT });
    const open = cases.filter((c) => c.status !== "CLOSED");
    return {
      count: open.length,
      items: open.map((c) => ({
        entityType: "attention_case",
        entityId: c.id,
        reason: c.priority === "HIGH" ? "حالة انتباه عالية الأولوية" : "حالة انتباه تحتاج متابعة",
        urgency: c.priority === "HIGH" ? ("HIGH" as const) : ("MEDIUM" as const),
        nextAction: c.status === "NEW" ? "ابدأ المتابعة" : "تواصل مع ولي الأمر",
      })),
    };
  }

  // ---------------------------------------------------------------------
  // Follow-ups → followup.read
  // ---------------------------------------------------------------------

  private async buildFollowUpsSection(authUser: VerifiedSupabaseToken, workspaceContext: WorkspaceContext, now: Date) {
    const grant = await this.permissionResolver.hasPermission(workspaceContext.workspaceId, authUser.id, "followup.read");
    if (!grant) return undefined;
    const restrictToGroupIds = grant.scope === "ALL_GROUPS" ? undefined : (grant.groupIds ?? []);
    const followups = await this.attentionRepository.listScheduledFollowups({ workspaceId: workspaceContext.workspaceId, status: "PENDING", restrictToGroupIds, limit: SECTION_ITEM_LIMIT });
    const due = followups.filter((f) => f.dueAt <= now);
    return {
      count: due.length,
      items: due.map((f) => ({
        entityType: "scheduled_followup",
        entityId: f.id,
        reason: "متابعة مستحقة",
        urgency: "MEDIUM" as const,
        nextAction: "أكمل المتابعة",
      })),
    };
  }

  // ---------------------------------------------------------------------
  // Missing Records → attendance.read (mirrors §11.8's own permission choice)
  // ---------------------------------------------------------------------

  private async buildMissingRecordsSection(authUser: VerifiedSupabaseToken, workspaceContext: WorkspaceContext) {
    const grant = await this.permissionResolver.hasPermission(workspaceContext.workspaceId, authUser.id, "attendance.read");
    if (!grant) return undefined;
    const visibleGroupIds = grant.scope === "ALL_GROUPS" ? ("ALL" as const) : (grant.groupIds ?? []);
    const sessionsWithGaps = await this.repository.listSessionsWithMissingRecords(workspaceContext.workspaceId, visibleGroupIds, SECTION_ITEM_LIMIT);
    return {
      count: sessionsWithGaps.length,
      items: sessionsWithGaps.map((s) => ({
        entityType: "session",
        entityId: s.sessionId,
        reason: `${s.missingCount} سجل ناقص في مجموعة «${s.groupName}»`,
        urgency: "MEDIUM" as const,
        nextAction: "أكمل السجلات الناقصة",
      })),
    };
  }

  // ---------------------------------------------------------------------
  // Collection → payments.view_student_status OR finance.overview — never
  // shown to a caller with neither (not even a zeroed count).
  // ---------------------------------------------------------------------

  private async buildCollectionSection(authUser: VerifiedSupabaseToken, workspaceContext: WorkspaceContext) {
    const [viewGrant, overviewGrant] = await Promise.all([
      this.permissionResolver.hasPermission(workspaceContext.workspaceId, authUser.id, "payments.view_student_status"),
      this.permissionResolver.hasPermission(workspaceContext.workspaceId, authUser.id, "finance.overview"),
    ]);
    if (!viewGrant && !overviewGrant) return undefined;
    const restrictToGroupIds = this.unionGroupScope([viewGrant, overviewGrant]);
    const rows = await this.financeRepository.listCollectionQueue({ workspaceId: workspaceContext.workspaceId, restrictToGroupIds, limit: SECTION_ITEM_LIMIT });
    return {
      count: rows.length,
      items: rows.map((r) => ({
        entityType: "financial_obligation",
        entityId: r.obligation.id,
        reason: `متبقٍ ${r.obligation.remainingMinor} قرش على ${r.studentName}`,
        urgency: r.obligation.status === "UNPAID" ? ("HIGH" as const) : ("MEDIUM" as const),
        nextAction: "سجّل دفعة",
      })),
    };
  }

  private unionGroupScope(grants: Array<{ scope: string; groupIds?: string[] } | undefined>): string[] | undefined {
    const granted = grants.filter((g): g is NonNullable<typeof g> => !!g);
    if (granted.some((g) => g.scope === "ALL_GROUPS")) return undefined;
    const union = new Set<string>();
    for (const g of granted) for (const id of g.groupIds ?? []) union.add(id);
    return [...union];
  }

  // ---------------------------------------------------------------------
  // Subscription warning → Owner only (billing is Owner-only in V1, per
  // Phase 8's own `BillingService.assertOwner` convention).
  // ---------------------------------------------------------------------

  private async buildSubscriptionWarning(workspaceContext: WorkspaceContext) {
    if (workspaceContext.membership.roleLabel !== OWNER_ROLE_LABEL) return undefined;
    const subscription = await this.billingRepository.findSubscriptionByWorkspaceId(workspaceContext.workspaceId);
    if (!subscription || !SUBSCRIPTION_WARNING_STATES.has(subscription.state)) return undefined;

    const daysRemaining = subscription.periodEnd ? Math.ceil((subscription.periodEnd.getTime() - Date.now()) / MS_PER_DAY) : null;
    const message =
      subscription.state === "EXPIRED" || subscription.state === "PAYMENT_FAILED"
        ? "الاشتراك منتهٍ — القراءة التاريخية متاحة، العمليات التشغيلية متوقفة حتى التجديد."
        : `اشتراكك ${daysRemaining !== null ? `سينتهي خلال ${daysRemaining} يوم` : "على وشك الانتهاء"}.`;

    return { state: subscription.state, daysRemaining, message };
  }

  // ---------------------------------------------------------------------
  // Next session — any active member, scoped to their own visible groups
  // (groups.view — not one of the 5 explicitly-gated sections, but still
  // never leaks a hidden group's session).
  // ---------------------------------------------------------------------

  private async buildNextSession(authUser: VerifiedSupabaseToken, workspaceContext: WorkspaceContext, now: Date) {
    const grant = await this.permissionResolver.hasPermission(workspaceContext.workspaceId, authUser.id, "groups.view");
    const visibleGroupIds = !grant || grant.scope === "ALL_GROUPS" ? ("ALL" as const) : (grant.groupIds ?? []);
    const next = await this.repository.getNextSession(workspaceContext.workspaceId, visibleGroupIds, now);
    if (!next) return undefined;
    return { id: next.sessionId, groupName: next.groupName, scheduledAt: next.scheduledAt.toISOString() };
  }
}
