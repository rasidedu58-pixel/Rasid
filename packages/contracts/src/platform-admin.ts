import { z } from "zod";
import { cursorPageSchema } from "./pagination";

/**
 * Rasid Platform Admin contract types — Phase 12. A platform-level
 * privileged administrator, structurally separate from any tenant/
 * workspace membership (see `packages/database/src/schema/platform-
 * admin.ts`'s own module comment for the full security-model rationale).
 * READ-ONLY in V1: no mutation endpoints exist yet (workspace suspension
 * etc. deliberately deferred — see the Phase 12 closure report).
 */

export const platformAdminUserSummarySchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  emailDisplay: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
  workspaceCount: z.number().int(),
});
export type PlatformAdminUserSummary = z.infer<typeof platformAdminUserSummarySchema>;

export const listPlatformAdminUsersResponseSchema = cursorPageSchema(platformAdminUserSummarySchema);
export type ListPlatformAdminUsersResponse = z.infer<typeof listPlatformAdminUsersResponseSchema>;

export const platformAdminMembershipRefSchema = z.object({
  workspaceId: z.string().uuid(),
  workspaceName: z.string(),
  roleLabel: z.string(),
  status: z.string(),
});

export const platformAdminUserDetailSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  emailDisplay: z.string().nullable(),
  phone: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
  memberships: z.array(platformAdminMembershipRefSchema),
});
export type PlatformAdminUserDetail = z.infer<typeof platformAdminUserDetailSchema>;

export const platformAdminWorkspaceSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  ownerUserId: z.string().uuid(),
  ownerName: z.string().nullable(),
  workspaceType: z.string(),
  status: z.string(),
  createdAt: z.string(),
  subscriptionState: z.string().nullable(),
});
export type PlatformAdminWorkspaceSummary = z.infer<typeof platformAdminWorkspaceSummarySchema>;

export const listPlatformAdminWorkspacesResponseSchema = cursorPageSchema(platformAdminWorkspaceSummarySchema);
export type ListPlatformAdminWorkspacesResponse = z.infer<typeof listPlatformAdminWorkspacesResponseSchema>;

export const platformAdminMemberSchema = z.object({
  userId: z.string().uuid(),
  fullName: z.string(),
  emailDisplay: z.string().nullable(),
  roleLabel: z.string(),
  status: z.string(),
});

export const platformAdminSubscriptionRefSchema = z.object({
  id: z.string().uuid(),
  provider: z.string(),
  state: z.string(),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  providerCustomerId: z.string().nullable(),
  providerSubscriptionId: z.string().nullable(),
});

export const platformAdminWorkspaceDetailSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  workspaceType: z.string(),
  status: z.string(),
  timezone: z.string(),
  dueDatePolicy: z.string(),
  createdAt: z.string(),
  ownerUserId: z.string().uuid(),
  ownerName: z.string().nullable(),
  ownerPhone: z.string().nullable(),
  ownerGovernorate: z.string().nullable(),
  ownerSubject: z.string().nullable(),
  ownerSubjectOther: z.string().nullable(),
  members: z.array(platformAdminMemberSchema),
  // NOTE: subscription is deliberately NOT part of the customers.view workspace
  // detail — it is sensitive billing data fetched separately from
  // `GET /workspaces/:id/subscription`, gated by `platform.subscriptions.view`,
  // so a customers.view-only role (SUPPORT_AGENT) can never obtain it here.
  entitlements: z.array(z.object({ capability: z.string(), state: z.string() })),
});
export type PlatformAdminWorkspaceDetail = z.infer<typeof platformAdminWorkspaceDetailSchema>;

/** Dedicated subscription read for one workspace — gated by platform.subscriptions.view. */
export const platformWorkspaceSubscriptionResponseSchema = z.object({
  subscription: platformAdminSubscriptionRefSchema.nullable(),
});
export type PlatformWorkspaceSubscriptionResponse = z.infer<typeof platformWorkspaceSubscriptionResponseSchema>;

export const platformAdminSubscriptionSummarySchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  workspaceName: z.string(),
  provider: z.string(),
  state: z.string(),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
});
export type PlatformAdminSubscriptionSummary = z.infer<typeof platformAdminSubscriptionSummarySchema>;

export const listPlatformAdminSubscriptionsResponseSchema = cursorPageSchema(platformAdminSubscriptionSummarySchema);
export type ListPlatformAdminSubscriptionsResponse = z.infer<typeof listPlatformAdminSubscriptionsResponseSchema>;

/**
 * Dashboard counts — only what's directly, correctly computable from
 * existing columns (§ real Phase 12 instruction: "لا تخترع MRR إن لم تكن
 * البيانات قابلة للحساب بشكل صحيح"). No MRR/revenue figure is computed
 * anywhere — `subscriptions` has no price/amount column at all.
 */
export const platformAdminDashboardResponseSchema = z.object({
  totalUsers: z.number().int(),
  totalWorkspaces: z.number().int(),
  subscriptionsByState: z.record(z.string(), z.number().int()),
  recentSignups: z.array(z.object({ workspaceId: z.string().uuid(), name: z.string(), ownerName: z.string().nullable(), createdAt: z.string() })),
  expiringWithin7Days: z.number().int(),
});
export type PlatformAdminDashboardResponse = z.infer<typeof platformAdminDashboardResponseSchema>;

/**
 * Read-only operational snapshot for one workspace — the "support diagnostic".
 * `available:false` means the platform-admin DB role has not yet been granted
 * the (additive) read policies on the operational tables (see the pending
 * migration); the console degrades gracefully to identity/subscription only
 * until that migration is applied. No PII beyond what support needs.
 */
export const platformOperationalSnapshotSchema = z.object({
  available: z.boolean(),
  currentMonth: z.object({ id: z.string().uuid(), year: z.number().int(), month: z.number().int(), status: z.string() }).nullable(),
  groupsCount: z.number().int().nullable(),
  studentsCount: z.number().int().nullable(),
  activeEnrollmentsCount: z.number().int().nullable(),
  sessionsThisMonth: z.object({ total: z.number().int(), completed: z.number().int() }).nullable(),
  lastActivityAt: z.string().nullable(),
});
export type PlatformOperationalSnapshot = z.infer<typeof platformOperationalSnapshotSchema>;

/** A single "needs attention" row for the platform command center. */
export const platformAttentionItemSchema = z.object({
  workspaceId: z.string().uuid(),
  workspaceName: z.string(),
  ownerName: z.string().nullable(),
  state: z.string(),
  periodEnd: z.string().nullable(),
  daysLeft: z.number().int().nullable(),
});
export const platformNeedsAttentionResponseSchema = z.object({
  trialsExpiringSoon: z.array(platformAttentionItemSchema),
  expired: z.array(platformAttentionItemSchema),
  paymentFailed: z.array(platformAttentionItemSchema),
});
export type PlatformNeedsAttentionResponse = z.infer<typeof platformNeedsAttentionResponseSchema>;

/** Read-only platform activity feed (operational events, never noisy tech logs). */
export const platformActivityItemSchema = z.object({
  kind: z.enum(["workspace.created", "subscription.state_changed"]),
  at: z.string(),
  workspaceId: z.string().uuid().nullable(),
  workspaceName: z.string().nullable(),
  label: z.string(),
  detail: z.string().nullable(),
});
export const platformActivityResponseSchema = z.object({
  items: z.array(platformActivityItemSchema),
  available: z.boolean(),
});
export type PlatformActivityResponse = z.infer<typeof platformActivityResponseSchema>;
