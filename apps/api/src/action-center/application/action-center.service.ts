import { Inject, Injectable } from "@nestjs/common";
import { attentionCardSubtitle, attentionRuleLabel, formatEgpMinor, type AttentionReasonDto } from "@academic-precision/contracts";
import type { ActionCenterResponse } from "@academic-precision/contracts";
import type {
  AttentionCaseListItem,
  CollectionQueueRow,
  FollowupListItem,
  MissedSessionItem,
  MissingRecordsSessionItem,
  NextSessionItem,
  SubscriptionRow,
} from "@academic-precision/database";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import type { WorkspaceContext } from "../../team/api/guards/permission.guard";
import { PermissionResolverService } from "../../team/application/permission-resolver.service";
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
  ) {}

  async getActionCenter(authUser: VerifiedSupabaseToken, workspaceContext: WorkspaceContext): Promise<ActionCenterResponse> {
    const workspaceId = workspaceContext.workspaceId;
    const now = new Date();

    // Phase 15C — resolve the caller's effective permissions ONCE, reusing
    // the membership PermissionGuard already fetched (from the SAME team
    // repository the resolver uses — safe, unlike /context's identity-side
    // membership). Every section's group-scope filter is derived from this
    // single resolution, and all still-needed sections are then fetched in
    // ONE transaction (was 7). Semantics are unchanged: a section the caller
    // lacks permission for is simply not requested, and the per-section JS
    // post-filters below are preserved exactly.
    const effective = await this.permissionResolver.resolveEffectivePermissions(
      workspaceId,
      authUser.id,
      workspaceContext.membership,
    );
    const grantFor = (permission: string) => effective.find((g) => g.permission === permission);
    const restrict = (grant: { scope: string; groupIds?: string[] } | undefined) =>
      !grant ? [] : grant.scope === "ALL_GROUPS" ? undefined : (grant.groupIds ?? []);

    const followupGrant = grantFor("followup.read");
    const attendanceGrant = grantFor("attendance.read");
    const paymentsGrant = grantFor("payments.view_student_status");
    const financeGrant = grantFor("finance.overview");
    const groupsGrant = grantFor("groups.view");
    const isOwner = workspaceContext.membership.roleLabel === OWNER_ROLE_LABEL;

    const data = await this.repository.loadActionCenterData({
      workspaceId,
      now,
      limit: SECTION_ITEM_LIMIT,
      attention: followupGrant ? { restrictToGroupIds: restrict(followupGrant) } : undefined,
      followups: followupGrant ? { restrictToGroupIds: restrict(followupGrant) } : undefined,
      missing: attendanceGrant
        ? { visibleGroupIds: attendanceGrant.scope === "ALL_GROUPS" ? "ALL" : (attendanceGrant.groupIds ?? []) }
        : undefined,
      // Missed-sessions bucket rides on the same permission as missing-
      // records: both are attendance-side surfaces. Kept as a separate
      // param so a future policy split remains one-line without touching
      // the repository.
      missed: attendanceGrant
        ? { visibleGroupIds: attendanceGrant.scope === "ALL_GROUPS" ? "ALL" : (attendanceGrant.groupIds ?? []) }
        : undefined,
      collection: paymentsGrant || financeGrant ? { restrictToGroupIds: this.unionGroupScope([paymentsGrant, financeGrant]) } : undefined,
      subscription: isOwner,
      nextSession: {
        visibleGroupIds: !groupsGrant || groupsGrant.scope === "ALL_GROUPS" ? "ALL" : (groupsGrant.groupIds ?? []),
      },
    });

    return {
      month: data.month ?? null,
      nextSession: this.toNextSection(data.nextSession),
      attention: followupGrant ? this.toAttentionSection(data.attentionCases ?? []) : undefined,
      followUpsDue: followupGrant ? this.toFollowUpsSection(data.followups ?? [], now) : undefined,
      missingRecords: attendanceGrant ? this.toMissingRecordsSection(data.missingRecords ?? []) : undefined,
      missedSessions: attendanceGrant ? this.toMissedSessionsSection(data.missedSessions ?? []) : undefined,
      collection: paymentsGrant || financeGrant ? this.toCollectionSection(data.collection ?? []) : undefined,
      subscriptionWarning: isOwner ? this.toSubscriptionWarning(data.subscription) : undefined,
      asOf: now.toISOString(),
    };
  }

  // ---------------------------------------------------------------------
  // Phase 15C — the section builders are now PURE mappers over rows fetched
  // by the single `loadActionCenterData` transaction. Permission gating and
  // group-scope derivation moved to `getActionCenter` (one resolution); the
  // reason strings, urgency logic, and JS post-filters are unchanged.
  // ---------------------------------------------------------------------

  private toAttentionSection(items: AttentionCaseListItem[]) {
    const open = items.filter((i) => i.case.status !== "CLOSED");
    return {
      count: open.length,
      // Title explains WHO and WHY (student name + the case's primary reason),
      // never a generic "حالة انتباه" — e.g. "أحمد محمد — غياب متكرر".
      // `subtitle` (optional, rolling-deploy safe) carries the concrete
      // detail line derived from the primary reason's real evidence — e.g.
      // "3 من آخر 5 حصص" — so the dashboard row explains WHY without the
      // teacher having to open the case.
      items: open.map((i) => ({
        entityType: "attention_case",
        entityId: i.case.id,
        reason: `${i.studentName} — ${attentionRuleLabel(i.primaryRuleKey)}`,
        urgency: i.case.priority === "HIGH" ? ("HIGH" as const) : ("MEDIUM" as const),
        nextAction: i.case.status === "NEW" ? "ابدأ المتابعة" : "تواصل مع ولي الأمر",
        subtitle: this.buildAttentionSubtitle(i),
      })),
    };
  }

  /**
   * Build the optional card subtitle from a case's primary reason. Uses
   * the shared `attentionCardSubtitle` in `@academic-precision/contracts`
   * so the exact wording matches the case detail page (single source of
   * truth). Returns undefined when there is no primary reason or the
   * evidence does not contain a concrete count / date — in that case the
   * teacher sees the main line alone (no fabricated subtitle).
   */
  private buildAttentionSubtitle(item: AttentionCaseListItem): string | undefined {
    if (!item.primaryReason) return undefined;
    const reasonDto: AttentionReasonDto = {
      id: "primary", // synthetic id — the DTO is only used by attentionCardSubtitle, which does not read it
      ruleKey: item.primaryReason.ruleKey,
      severity: item.primaryReason.severity,
      groupId: "", // ditto — not read by the helper
      firstDetectedAt: item.primaryReason.firstDetectedAt.toISOString(),
      lastDetectedAt: item.primaryReason.lastDetectedAt.toISOString(),
      evidence: item.primaryReason.evidence.map((e, idx) => ({
        id: `primary-${idx}`,
        sourceType: e.sourceType as "SESSION_RECORD" | "SESSION",
        sourceId: "",
        observedAt: e.observedAt.toISOString(),
        snapshot: e.snapshot,
      })),
    };
    return attentionCardSubtitle(reasonDto);
  }

  private toFollowUpsSection(items: FollowupListItem[], now: Date) {
    const due = items.filter((i) => i.followup.dueAt <= now);
    return {
      count: due.length,
      items: due.map((i) => ({
        entityType: "scheduled_followup",
        entityId: i.followup.id,
        reason: `متابعة مستحقة لـ ${i.studentName}`,
        urgency: "MEDIUM" as const,
        nextAction: "أكمل المتابعة",
      })),
    };
  }

  private toMissingRecordsSection(sessionsWithGaps: MissingRecordsSessionItem[]) {
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

  /**
   * «فائتة — لم تُسجَّل» bucket. The stored status is preserved on the
   * `entityId` side (the session id), and the reason line names the group
   * so the teacher immediately knows WHICH missed session it is. The
   * `nextAction` is the exact wording from Phase 6 of the owner's spec.
   *
   * `urgency` is HIGH here — a missed session is a real operational gap
   * the teacher needs to reconcile, distinct from a merely-partial live
   * session (missing-records = MEDIUM).
   */
  private toMissedSessionsSection(missed: MissedSessionItem[]) {
    return {
      count: missed.length,
      items: missed.map((s) => ({
        entityType: "session",
        entityId: s.sessionId,
        reason: `فائتة — لم تُسجَّل في مجموعة «${s.groupName}»`,
        urgency: "HIGH" as const,
        nextAction: "تسجيل الحصة الآن",
      })),
    };
  }

  private toCollectionSection(rows: CollectionQueueRow[]) {
    return {
      count: rows.length,
      items: rows.map((r) => ({
        entityType: "financial_obligation",
        entityId: r.obligation.id,
        reason: `متبقٍ ${formatEgpMinor(r.obligation.remainingMinor)} على ${r.studentName}`,
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

  private toSubscriptionWarning(subscription: SubscriptionRow | undefined) {
    if (!subscription || !SUBSCRIPTION_WARNING_STATES.has(subscription.state)) return undefined;
    const daysRemaining = subscription.periodEnd ? Math.ceil((subscription.periodEnd.getTime() - Date.now()) / MS_PER_DAY) : null;
    const message =
      subscription.state === "EXPIRED" || subscription.state === "PAYMENT_FAILED"
        ? "الاشتراك منتهٍ — القراءة التاريخية متاحة، العمليات التشغيلية متوقفة حتى التجديد."
        : `اشتراكك ${daysRemaining !== null ? `سينتهي خلال ${daysRemaining} يوم` : "على وشك الانتهاء"}.`;
    return { state: subscription.state, daysRemaining, message };
  }

  private toNextSection(next: NextSessionItem | undefined) {
    if (!next) return undefined;
    return { id: next.sessionId, groupName: next.groupName, scheduledAt: next.scheduledAt.toISOString(), durationMinutes: next.durationMinutes, status: next.status };
  }
}
