import { z } from "zod";
import { cursorPageSchema } from "./pagination";

/**
 * Rasid Platform Operations — RBAC + the internal-ops WRITE units built on
 * top of the read-only platform-admin console (Phase C). Unlike tenant
 * permissions (workspace-scoped, `permission-catalog.ts`), these are
 * COMPANY-level roles held by Rasid staff via the `platform_admins`
 * allowlist. The model is intentionally small: three fixed roles, a flat
 * permission enum, and a static role→permissions map — no per-user custom
 * grants, no DB permissions table. Membership in `platform_admins` is still
 * the outer gate (`PlatformAdminGuard`); the role only decides WHICH
 * platform actions that already-authorized staff member may take.
 */

// --- Roles ------------------------------------------------------------------
export const PLATFORM_ROLES = ["PLATFORM_OWNER", "OPERATIONS_ADMIN", "SUPPORT_AGENT"] as const;
export const platformRoleSchema = z.enum(PLATFORM_ROLES);
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

// --- Permissions ------------------------------------------------------------
// The permission model governs BOTH reads and writes. Every key here is wired
// to a real endpoint OR expresses a security boundary the tests enforce — no
// speculative/unused permissions. Reserved keys (operating-months, staff
// management) are held by their eventual owner roles now so the boundary is
// enforced and tested before those units ship.
export const PLATFORM_PERMISSIONS = [
  // --- Reads ---
  "platform.customers.view", // workspaces list/detail (Customer 360), users, operational snapshot, needs-attention, activity, dashboard
  "platform.subscriptions.view", // the global cross-customer subscriptions list
  "platform.support.view", // contact logs + follow-ups + staff list (reads)
  // --- Writes (Unit 1) ---
  "platform.support.manage", // record a contact log; create / resolve / cancel / reassign / reschedule follow-ups
  // --- Platform status & issues (Issues Center) ---
  "platform.health.view", // overall status + per-service status + active issues
  "platform.health.details", // operational detail: worker job metrics + recent problems
  // --- Operating-Month Overrides ---
  "platform.operating_months.manage",
  // --- Customer & Subscription controls ---
  "platform.customers.manage", // suspend / reactivate a customer account; edit operational fields; create a customer via secure invite
  "platform.subscriptions.manage", // extend trial, set end date, suspend / reactivate a subscription
  // --- Billing (Phase 3): payment requests + manual payment verification ---
  "platform.billing.view", // read the payment-requests / payments list
  "platform.billing.manage", // confirm / reject a payment request (a real financial action — never SUPPORT_AGENT)
  // --- Workspace feature overrides ---
  "platform.features.manage", // enable / disable / revoke a per-workspace feature override
  // --- Owner-only: platform staff / role management ---
  "platform.staff.manage",
] as const;
export const platformPermissionSchema = z.enum(PLATFORM_PERMISSIONS);
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

/**
 * Static role → permissions map. Backend is the source of authority (guards);
 * UI hiding is UX-only.
 * - PLATFORM_OWNER: the entire Platform Operations surface, including owner-only
 *   security operations (staff/role management).
 * - OPERATIONS_ADMIN: customers, subscriptions, support, and operating-month
 *   operations — but NOT owner-only staff/role management.
 * - SUPPORT_AGENT: only the customer-support data it needs — find customers,
 *   read a Customer 360, and log contacts / manage follow-ups. NOT the global
 *   subscriptions list, operating months, or staff management.
 */
export const ROLE_PERMISSIONS: Record<PlatformRole, readonly PlatformPermission[]> = {
  PLATFORM_OWNER: [...PLATFORM_PERMISSIONS],
  OPERATIONS_ADMIN: [
    "platform.customers.view",
    "platform.customers.manage",
    "platform.subscriptions.view",
    "platform.subscriptions.manage",
    "platform.billing.view",
    "platform.billing.manage",
    "platform.support.view",
    "platform.support.manage",
    "platform.health.view",
    "platform.health.details",
    "platform.operating_months.manage",
    "platform.features.manage",
  ],
  // SUPPORT_AGENT deliberately has NEITHER platform.billing.* — no financial confirm.
  SUPPORT_AGENT: ["platform.customers.view", "platform.support.view", "platform.support.manage", "platform.health.view"],
};

export function hasPlatformPermission(role: PlatformRole | null | undefined, permission: PlatformPermission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

// --- Unit 1: Customer Communication -----------------------------------------
// Prefixed `Platform*` throughout — the tenant side (attention.ts) has its own
// teacher→student `contactLog`/`contactChannel` types; these are distinct
// company→customer records and must not clash in the barrel export.
export const PLATFORM_CONTACT_CHANNELS = ["CALL", "WHATSAPP", "EMAIL", "SMS", "IN_PERSON", "OTHER"] as const;
export const platformContactChannelSchema = z.enum(PLATFORM_CONTACT_CHANNELS);
export type PlatformContactChannel = (typeof PLATFORM_CONTACT_CHANNELS)[number];

export const PLATFORM_CONTACT_DIRECTIONS = ["OUTBOUND", "INBOUND"] as const;
export const platformContactDirectionSchema = z.enum(PLATFORM_CONTACT_DIRECTIONS);
export type PlatformContactDirection = (typeof PLATFORM_CONTACT_DIRECTIONS)[number];

export const platformContactLogSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  channel: platformContactChannelSchema,
  direction: platformContactDirectionSchema,
  summary: z.string(),
  occurredAt: z.string(),
  createdAt: z.string(),
  createdByUserId: z.string().uuid().nullable(),
  createdByName: z.string().nullable(),
});
export type PlatformContactLog = z.infer<typeof platformContactLogSchema>;

export const listPlatformContactLogsResponseSchema = cursorPageSchema(platformContactLogSchema);
export type ListPlatformContactLogsResponse = z.infer<typeof listPlatformContactLogsResponseSchema>;

export const createPlatformContactLogRequestSchema = z.object({
  channel: platformContactChannelSchema,
  direction: platformContactDirectionSchema.default("OUTBOUND"),
  summary: z.string().trim().min(1, "الملخص مطلوب").max(2000),
  // Optional: when the contact actually happened (defaults to now server-side).
  occurredAt: z.string().datetime().optional(),
});
export type CreatePlatformContactLogRequest = z.infer<typeof createPlatformContactLogRequestSchema>;

// --- Unit 1: Follow-ups -----------------------------------------------------
export const FOLLOW_UP_STATUSES = ["PENDING", "DONE", "CANCELLED"] as const;
export const followUpStatusSchema = z.enum(FOLLOW_UP_STATUSES);
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export const followUpSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  workspaceName: z.string().nullable(),
  title: z.string(),
  note: z.string().nullable(),
  dueAt: z.string().nullable(),
  status: followUpStatusSchema,
  createdAt: z.string(),
  createdByUserId: z.string().uuid().nullable(),
  createdByName: z.string().nullable(),
  assignedToUserId: z.string().uuid().nullable(),
  assignedToName: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  resolvedByName: z.string().nullable(),
});
export type FollowUp = z.infer<typeof followUpSchema>;

export const listFollowUpsResponseSchema = cursorPageSchema(followUpSchema);
export type ListFollowUpsResponse = z.infer<typeof listFollowUpsResponseSchema>;

export const createFollowUpRequestSchema = z.object({
  title: z.string().trim().min(1, "العنوان مطلوب").max(300),
  note: z.string().trim().max(2000).optional(),
  dueAt: z.string().datetime().optional(),
  assignedToUserId: z.string().uuid().optional(),
});
export type CreateFollowUpRequest = z.infer<typeof createFollowUpRequestSchema>;

export const updateFollowUpRequestSchema = z
  .object({
    status: z.enum(["DONE", "CANCELLED"]).optional(),
    assignedToUserId: z.string().uuid().nullable().optional(),
    dueAt: z.string().datetime().nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.assignedToUserId !== undefined || v.dueAt !== undefined, {
    message: "لا يوجد تغيير",
  });
export type UpdateFollowUpRequest = z.infer<typeof updateFollowUpRequestSchema>;

// --- Operating-Month Overrides (Platform Ops) -------------------------------
export const MONTH_OVERRIDE_TYPES = ["EARLY_PREP_ALLOWED", "PREP_BLOCKED"] as const;
export const monthOverrideTypeSchema = z.enum(MONTH_OVERRIDE_TYPES);
export type MonthOverrideType = (typeof MONTH_OVERRIDE_TYPES)[number];

export const monthOverrideSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  type: monthOverrideTypeSchema,
  reason: z.string(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  revokedByName: z.string().nullable(),
  active: z.boolean(),
});
export type MonthOverride = z.infer<typeof monthOverrideSchema>;

export const listMonthOverridesResponseSchema = z.object({ items: z.array(monthOverrideSchema) });
export type ListMonthOverridesResponse = z.infer<typeof listMonthOverridesResponseSchema>;

export const createMonthOverrideRequestSchema = z.object({
  type: monthOverrideTypeSchema,
  reason: z.string().trim().min(1, "السبب مطلوب").max(2000),
  expiresAt: z.string().datetime().optional(),
});
export type CreateMonthOverrideRequest = z.infer<typeof createMonthOverrideRequestSchema>;

// --- Customer Account Controls ----------------------------------------------
export const customerAccountActionRequestSchema = z.object({
  action: z.enum(["SUSPEND", "REACTIVATE"]),
  reason: z.string().trim().min(1, "السبب مطلوب").max(2000),
});
export type CustomerAccountActionRequest = z.infer<typeof customerAccountActionRequestSchema>;

/** Edit the allowed operational fields of a customer (never auth/email identity). */
export const editCustomerRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    ownerPhone: z.string().trim().max(40).nullable().optional(),
    reason: z.string().trim().min(1, "السبب مطلوب").max(2000),
  })
  .refine((v) => v.name !== undefined || v.ownerPhone !== undefined, { message: "لا يوجد تغيير" });
export type EditCustomerRequest = z.infer<typeof editCustomerRequestSchema>;

// --- Subscription / Trial Controls ------------------------------------------
export const subscriptionAdminActionRequestSchema = z
  .object({
    action: z.enum(["EXTEND_DAYS", "SET_END_DATE", "SUSPEND", "REACTIVATE"]),
    reason: z.string().trim().min(1, "السبب مطلوب").max(2000),
    days: z.number().int().min(1).max(365).optional(),
    endDate: z.string().datetime().optional(),
  })
  .refine((v) => v.action !== "EXTEND_DAYS" || typeof v.days === "number", { message: "عدد الأيام مطلوب", path: ["days"] })
  .refine((v) => v.action !== "SET_END_DATE" || typeof v.endDate === "string", { message: "تاريخ الانتهاء مطلوب", path: ["endDate"] });
export type SubscriptionAdminActionRequest = z.infer<typeof subscriptionAdminActionRequestSchema>;

/** A platform staff member who can be assigned follow-ups (the allowlist). */
export const platformStaffRefSchema = z.object({
  userId: z.string().uuid(),
  fullName: z.string(),
  role: platformRoleSchema,
});
export type PlatformStaffRef = z.infer<typeof platformStaffRefSchema>;

export const listPlatformStaffResponseSchema = z.object({ items: z.array(platformStaffRefSchema) });
export type ListPlatformStaffResponse = z.infer<typeof listPlatformStaffResponseSchema>;

// ===========================================================================
// Platform Staff Management ("فريق راصد") — OWNER-only (platform.staff.manage).
// A platform staff member is a `platform_admins` row (company-level, NOT a
// tenant membership). New staff join ONLY by accepting a secure invite — the
// admin never sets a password. Disabling flips status to DISABLED, which the
// PlatformAdminGuard treats as no-access (real backend enforcement).
// ===========================================================================
export const PLATFORM_STAFF_STATUSES = ["ACTIVE", "DISABLED"] as const;
export const platformStaffStatusSchema = z.enum(PLATFORM_STAFF_STATUSES);
export type PlatformStaffStatus = (typeof PLATFORM_STAFF_STATUSES)[number];

export const platformStaffMemberSchema = z.object({
  userId: z.string().uuid(),
  fullName: z.string().nullable(),
  email: z.string().nullable(),
  role: platformRoleSchema,
  status: platformStaffStatusSchema,
  invitedByName: z.string().nullable(),
  grantedAt: z.string(),
  /** True for the caller's own row — the UI blocks self role-change / self-disable. */
  isSelf: z.boolean(),
});
export type PlatformStaffMember = z.infer<typeof platformStaffMemberSchema>;

export const listPlatformStaffMembersResponseSchema = z.object({ items: z.array(platformStaffMemberSchema) });
export type ListPlatformStaffMembersResponse = z.infer<typeof listPlatformStaffMembersResponseSchema>;

export const platformInvitationStatusSchema = z.enum(["PENDING", "ACCEPTED", "REVOKED"]);
export type PlatformInvitationStatus = z.infer<typeof platformInvitationStatusSchema>;

export const platformStaffInvitationSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  role: platformRoleSchema,
  status: platformInvitationStatusSchema,
  invitedByName: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
  acceptedAt: z.string().nullable(),
  expired: z.boolean(),
});
export type PlatformStaffInvitation = z.infer<typeof platformStaffInvitationSchema>;

export const listPlatformStaffInvitationsResponseSchema = z.object({ items: z.array(platformStaffInvitationSchema) });
export type ListPlatformStaffInvitationsResponse = z.infer<typeof listPlatformStaffInvitationsResponseSchema>;

export const createPlatformStaffInvitationRequestSchema = z.object({
  email: z.string().trim().email("بريد غير صالح").max(320),
  role: platformRoleSchema,
});
export type CreatePlatformStaffInvitationRequest = z.infer<typeof createPlatformStaffInvitationRequestSchema>;

/** Returns the raw token ONCE (never stored/logged in raw form). */
export const createPlatformStaffInvitationResponseSchema = z.object({
  id: z.string().uuid(),
  token: z.string(),
  expiresAt: z.string(),
});
export type CreatePlatformStaffInvitationResponse = z.infer<typeof createPlatformStaffInvitationResponseSchema>;

export const changePlatformStaffRoleRequestSchema = z.object({
  role: platformRoleSchema,
  reason: z.string().trim().min(1, "السبب مطلوب").max(2000),
});
export type ChangePlatformStaffRoleRequest = z.infer<typeof changePlatformStaffRoleRequestSchema>;

export const platformStaffAccountActionRequestSchema = z.object({
  action: z.enum(["DISABLE", "REACTIVATE"]),
  reason: z.string().trim().min(1, "السبب مطلوب").max(2000),
});
export type PlatformStaffAccountActionRequest = z.infer<typeof platformStaffAccountActionRequestSchema>;

/** Invitee-facing preview of a staff invite (token-authorized, pre-acceptance). */
export const platformStaffInvitationPreviewSchema = z.object({
  valid: z.boolean(),
  status: platformInvitationStatusSchema,
  email: z.string(),
  role: platformRoleSchema,
  invitedByName: z.string().nullable(),
  expiresAt: z.string(),
});
export type PlatformStaffInvitationPreview = z.infer<typeof platformStaffInvitationPreviewSchema>;

export const acceptPlatformStaffInvitationResponseSchema = z.object({
  role: platformRoleSchema,
  status: platformStaffStatusSchema,
});
export type AcceptPlatformStaffInvitationResponse = z.infer<typeof acceptPlatformStaffInvitationResponseSchema>;

// ===========================================================================
// Customer Creation via Secure Invite — platform.customers.manage.
// The admin NEVER sets a password: they record the customer's identity and
// mint a secure, expiring, single-use onboarding link. The customer opens it,
// authenticates through the normal Supabase Auth (OTP) flow, and the existing
// lazy provisioning creates their own workspace + trial per current Product
// Rules. No new billing. The invite is a tracked, auditable onboarding record
// claimed atomically on first authenticated arrival — it never provisions
// anything itself before the customer accepts.
// ===========================================================================
export const customerInvitationSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  status: platformInvitationStatusSchema,
  invitedByName: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
  acceptedAt: z.string().nullable(),
  acceptedWorkspaceId: z.string().uuid().nullable(),
  expired: z.boolean(),
});
export type CustomerInvitation = z.infer<typeof customerInvitationSchema>;

export const listCustomerInvitationsResponseSchema = cursorPageSchema(customerInvitationSchema);
export type ListCustomerInvitationsResponse = z.infer<typeof listCustomerInvitationsResponseSchema>;

export const createCustomerInvitationRequestSchema = z.object({
  fullName: z.string().trim().min(1, "الاسم مطلوب").max(200),
  email: z.string().trim().email("بريد غير صالح").max(320),
  phone: z.string().trim().max(40).optional(),
});
export type CreateCustomerInvitationRequest = z.infer<typeof createCustomerInvitationRequestSchema>;

export const createCustomerInvitationResponseSchema = z.object({
  id: z.string().uuid(),
  token: z.string(),
  expiresAt: z.string(),
});
export type CreateCustomerInvitationResponse = z.infer<typeof createCustomerInvitationResponseSchema>;

export const customerInvitationPreviewSchema = z.object({
  valid: z.boolean(),
  status: platformInvitationStatusSchema,
  fullName: z.string(),
  email: z.string(),
  expiresAt: z.string(),
});
export type CustomerInvitationPreview = z.infer<typeof customerInvitationPreviewSchema>;

export const claimCustomerInvitationResponseSchema = z.object({
  status: platformInvitationStatusSchema,
  workspaceId: z.string().uuid().nullable(),
});
export type ClaimCustomerInvitationResponse = z.infer<typeof claimCustomerInvitationResponseSchema>;

// ===========================================================================
// Workspace Feature Overrides — platform.features.manage (OWNER + OPS).
// Layering: Global Feature Availability -> (Entitlement/Plan if any) ->
// Workspace Override. An override can ONLY target a feature key that exists in
// the code catalog below (it can never switch on a feature the code does not
// implement), and it is NOT a security bypass — feature access is separate
// from RBAC/permissions and from billing entitlements.
// ===========================================================================
export const featureOverrideStateSchema = z.enum(["ENABLED", "DISABLED"]);
export type FeatureOverrideState = z.infer<typeof featureOverrideStateSchema>;

/**
 * The allowlist of override-able product features — the ONLY keys a workspace
 * override may target, and the SAFETY BOUNDARY of the whole override mechanism.
 *
 * Precedence at runtime: an active workspace override WINS over the global
 * feature flag (ENABLE can turn a globally-off feature on for one customer;
 * DISABLE can turn a globally-on feature off). That is safe ONLY because every
 * key here is a "default rollout state" toggle. A HARD KILL SWITCH (a flag
 * turned off for operational/security reasons that must stay off everywhere)
 * must NOT be added to this catalog — leaving it out means no override can ever
 * bypass its global OFF. Billing capabilities (REPORT_EXPORT, CREATE_MONTH, …)
 * are likewise excluded: those are governed by entitlements, never by an
 * override, so an override can bypass neither billing nor security/RBAC.
 */
export const PLATFORM_FEATURE_CATALOG = [
  {
    key: "complete_session_with_missing_records",
    label: "إكمال الجلسة مع وجود نواقص",
    description: "السماح بإنهاء جلسة رغم وجود سجلات غير مكتملة لبعض الطلاب.",
  },
] as const;
export const PLATFORM_FEATURE_KEYS = PLATFORM_FEATURE_CATALOG.map((f) => f.key) as [string, ...string[]];
export const platformFeatureKeySchema = z.enum(PLATFORM_FEATURE_KEYS);
export type PlatformFeatureKey = (typeof PLATFORM_FEATURE_CATALOG)[number]["key"];

export function isPlatformFeatureKey(key: string): key is PlatformFeatureKey {
  return PLATFORM_FEATURE_CATALOG.some((f) => f.key === key);
}

export const workspaceFeatureSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string(),
  /** The product-wide default availability (global feature flag). */
  globalEnabled: z.boolean(),
  /** The effective state after applying any active override. */
  effectiveEnabled: z.boolean(),
  /** The active override for this workspace, if any. */
  override: z
    .object({
      state: featureOverrideStateSchema,
      reason: z.string(),
      createdByName: z.string().nullable(),
      createdAt: z.string(),
      expiresAt: z.string().nullable(),
    })
    .nullable(),
});
export type WorkspaceFeature = z.infer<typeof workspaceFeatureSchema>;

export const listWorkspaceFeaturesResponseSchema = z.object({ items: z.array(workspaceFeatureSchema) });
export type ListWorkspaceFeaturesResponse = z.infer<typeof listWorkspaceFeaturesResponseSchema>;

export const setFeatureOverrideRequestSchema = z.object({
  featureKey: platformFeatureKeySchema,
  state: featureOverrideStateSchema,
  reason: z.string().trim().min(1, "السبب مطلوب").max(2000),
  expiresAt: z.string().datetime().optional(),
});
export type SetFeatureOverrideRequest = z.infer<typeof setFeatureOverrideRequestSchema>;

export const revokeFeatureOverrideRequestSchema = z.object({
  featureKey: platformFeatureKeySchema,
  reason: z.string().trim().min(1, "السبب مطلوب").max(2000),
});
export type RevokeFeatureOverrideRequest = z.infer<typeof revokeFeatureOverrideRequestSchema>;
