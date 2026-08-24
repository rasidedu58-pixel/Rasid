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
  members: z.array(platformAdminMemberSchema),
  subscription: platformAdminSubscriptionRefSchema.nullable(),
  entitlements: z.array(z.object({ capability: z.string(), state: z.string() })),
});
export type PlatformAdminWorkspaceDetail = z.infer<typeof platformAdminWorkspaceDetailSchema>;

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
