import { Injectable } from "@nestjs/common";
import {
  hasPlatformPermission,
  type ListPlatformAdminSubscriptionsResponse,
  type ListPlatformAdminUsersResponse,
  type ListPlatformAdminWorkspacesResponse,
  type PlatformActivityResponse,
  type PlatformAdminDashboardResponse,
  type PlatformAdminUserDetail,
  type PlatformAdminWorkspaceDetail,
  type PlatformNeedsAttentionResponse,
  type PlatformOperationalSnapshot,
  type PlatformRole,
  type PlatformWorkspaceSubscriptionResponse,
} from "@academic-precision/contracts";
import {
  getDashboardStats,
  getNeedsAttention,
  getPlatformActivity,
  getUserDetail,
  getWorkspaceDetail,
  getWorkspaceOperationalSnapshot,
  getWorkspaceSubscriptionRef,
  listSubscriptions,
  listUsers,
  listWorkspaces,
  type PlatformAttentionRow,
} from "@academic-precision/database";

/**
 * Redaction helpers — the dashboard and activity feed MIX customers-view
 * content with subscription content in one response. A caller lacking
 * `platform.subscriptions.view` must not receive the subscription portion, so
 * these strip it out. Pure + exported for direct regression testing.
 */
export function redactDashboardForRole(
  dashboard: PlatformAdminDashboardResponse,
  role: PlatformRole | null,
): PlatformAdminDashboardResponse {
  if (hasPlatformPermission(role, "platform.subscriptions.view")) return dashboard;
  return { ...dashboard, subscriptionsByState: {}, expiringWithin7Days: 0 };
}
export function redactActivityForRole(activity: PlatformActivityResponse, role: PlatformRole | null): PlatformActivityResponse {
  if (hasPlatformPermission(role, "platform.subscriptions.view")) return activity;
  return { ...activity, items: activity.items.filter((i) => i.kind !== "subscription.state_changed") };
}
export function redactWorkspaceSummariesForRole<T extends { subscriptionState: string | null }>(items: T[], role: PlatformRole | null): T[] {
  if (hasPlatformPermission(role, "platform.subscriptions.view")) return items;
  return items.map((i) => ({ ...i, subscriptionState: null }));
}

const DAY_MS = 24 * 60 * 60 * 1000;
function daysLeft(periodEnd: Date | null): number | null {
  if (!periodEnd) return null;
  return Math.ceil((periodEnd.getTime() - Date.now()) / DAY_MS);
}
function toAttentionItem(r: PlatformAttentionRow) {
  return {
    workspaceId: r.workspaceId,
    workspaceName: r.workspaceName,
    ownerName: r.ownerName,
    state: r.state,
    periodEnd: r.periodEnd ? r.periodEnd.toISOString() : null,
    daysLeft: daysLeft(r.periodEnd),
  };
}
import { ResourceNotFoundException } from "../../common/exceptions/api.exception";

/**
 * Application service — Phase 12 Platform Admin. Read-only in V1 (see the
 * module's own README/closure-report note on why mutations like workspace
 * suspension were deliberately deferred). Every method here assumes the
 * caller has ALREADY passed `PlatformAdminGuard` — no authorization logic
 * lives here, only DTO mapping from repository rows to the contract shape
 * (Date -> ISO string, nulls preserved as-is).
 */
@Injectable()
export class PlatformAdminService {
  async getDashboard(role: PlatformRole | null): Promise<PlatformAdminDashboardResponse> {
    const stats = await getDashboardStats();
    const full: PlatformAdminDashboardResponse = {
      totalUsers: stats.totalUsers,
      totalWorkspaces: stats.totalWorkspaces,
      subscriptionsByState: stats.subscriptionsByState,
      recentSignups: stats.recentSignups.map((r) => ({
        workspaceId: r.workspaceId,
        name: r.name,
        ownerName: r.ownerName,
        createdAt: r.createdAt.toISOString(),
      })),
      expiringWithin7Days: stats.expiringWithin7Days,
    };
    return redactDashboardForRole(full, role);
  }

  async listUsers(params: { search?: string; cursor?: string; limit?: number }): Promise<ListPlatformAdminUsersResponse> {
    const result = await listUsers(params);
    return {
      items: result.items.map((u) => ({
        id: u.id,
        fullName: u.fullName,
        emailDisplay: u.emailDisplay,
        status: u.status,
        createdAt: u.createdAt.toISOString(),
        workspaceCount: u.workspaceCount,
      })),
      page: { hasNext: result.hasNext, nextCursor: result.nextCursor },
    };
  }

  async getUser(userId: string): Promise<PlatformAdminUserDetail> {
    const detail = await getUserDetail(userId);
    if (!detail) throw new ResourceNotFoundException();
    return {
      id: detail.user.id,
      fullName: detail.user.fullName,
      emailDisplay: detail.user.emailDisplay,
      phone: detail.user.phone,
      status: detail.user.status,
      createdAt: detail.user.createdAt.toISOString(),
      memberships: detail.memberships,
    };
  }

  async listWorkspaces(
    params: { search?: string; state?: string; cursor?: string; limit?: number },
    role: PlatformRole | null,
  ): Promise<ListPlatformAdminWorkspacesResponse> {
    // subscriptionState (and the ability to filter by it) is subscription data:
    // a caller without platform.subscriptions.view cannot filter by it and never
    // receives it in the summary.
    const canViewSubs = hasPlatformPermission(role, "platform.subscriptions.view");
    // Also refuse the subscription-state FILTER for a caller who can't see it.
    const effectiveParams = canViewSubs ? params : { ...params, state: undefined };
    const result = await listWorkspaces(effectiveParams);
    const items = result.items.map((w) => ({
      id: w.id,
      name: w.name,
      ownerUserId: w.ownerUserId,
      ownerName: w.ownerName,
      workspaceType: w.workspaceType,
      status: w.status,
      createdAt: w.createdAt.toISOString(),
      subscriptionState: w.subscriptionState,
    }));
    return {
      items: redactWorkspaceSummariesForRole(items, role),
      page: { hasNext: result.hasNext, nextCursor: result.nextCursor },
    };
  }

  async getWorkspace(workspaceId: string): Promise<PlatformAdminWorkspaceDetail> {
    const detail = await getWorkspaceDetail(workspaceId);
    if (!detail) throw new ResourceNotFoundException();
    return {
      id: detail.workspace.id,
      name: detail.workspace.name,
      workspaceType: detail.workspace.workspaceType,
      status: detail.workspace.status,
      timezone: detail.workspace.timezone,
      dueDatePolicy: detail.workspace.dueDatePolicy,
      createdAt: detail.workspace.createdAt.toISOString(),
      ownerUserId: detail.workspace.ownerUserId,
      ownerName: detail.ownerName,
      ownerPhone: detail.ownerPhone,
      members: detail.members,
      entitlements: detail.entitlements,
    };
  }

  /** Sensitive billing read — the controller gates this with platform.subscriptions.view. */
  async getWorkspaceSubscription(workspaceId: string): Promise<PlatformWorkspaceSubscriptionResponse> {
    const s = await getWorkspaceSubscriptionRef(workspaceId);
    return {
      subscription: s
        ? {
            id: s.id,
            provider: s.provider,
            state: s.state,
            periodStart: s.periodStart ? s.periodStart.toISOString() : null,
            periodEnd: s.periodEnd ? s.periodEnd.toISOString() : null,
            cancelAtPeriodEnd: s.cancelAtPeriodEnd,
            providerCustomerId: s.providerCustomerId,
            providerSubscriptionId: s.providerSubscriptionId,
          }
        : null,
    };
  }

  async getNeedsAttention(): Promise<PlatformNeedsAttentionResponse> {
    const data = await getNeedsAttention();
    return {
      trialsExpiringSoon: data.trialsExpiringSoon.map(toAttentionItem),
      expired: data.expired.map(toAttentionItem),
      paymentFailed: data.paymentFailed.map(toAttentionItem),
    };
  }

  async getActivity(role: PlatformRole | null): Promise<PlatformActivityResponse> {
    const data = await getPlatformActivity();
    const full: PlatformActivityResponse = {
      available: data.available,
      items: data.items.map((i) => ({
        kind: i.kind,
        at: i.at.toISOString(),
        workspaceId: i.workspaceId,
        workspaceName: i.workspaceName,
        label: i.label,
        detail: i.detail,
      })),
    };
    return redactActivityForRole(full, role);
  }

  async getOperationalSnapshot(workspaceId: string): Promise<PlatformOperationalSnapshot> {
    const snap = await getWorkspaceOperationalSnapshot(workspaceId);
    return {
      available: snap.available,
      currentMonth: snap.currentMonth,
      groupsCount: snap.groupsCount,
      studentsCount: snap.studentsCount,
      activeEnrollmentsCount: snap.activeEnrollmentsCount,
      sessionsThisMonth: snap.sessionsThisMonth,
      lastActivityAt: snap.lastActivityAt ? snap.lastActivityAt.toISOString() : null,
    };
  }

  async listSubscriptions(params: { state?: string; cursor?: string; limit?: number }): Promise<ListPlatformAdminSubscriptionsResponse> {
    const result = await listSubscriptions(params);
    return {
      items: result.items.map((s) => ({
        id: s.id,
        workspaceId: s.workspaceId,
        workspaceName: s.workspaceName,
        provider: s.provider,
        state: s.state,
        periodStart: s.periodStart ? s.periodStart.toISOString() : null,
        periodEnd: s.periodEnd ? s.periodEnd.toISOString() : null,
        cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      })),
      page: { hasNext: result.hasNext, nextCursor: result.nextCursor },
    };
  }
}
