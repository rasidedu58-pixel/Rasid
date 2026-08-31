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
  // --- Reserved: Operating-Month Overrides (Unit 2) — held now to enforce the boundary ---
  "platform.operating_months.manage",
  // --- Owner-only: platform staff / role management (reserved) ---
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
    "platform.subscriptions.view",
    "platform.support.view",
    "platform.support.manage",
    "platform.health.view",
    "platform.health.details",
    "platform.operating_months.manage",
  ],
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

/** A platform staff member who can be assigned follow-ups (the allowlist). */
export const platformStaffRefSchema = z.object({
  userId: z.string().uuid(),
  fullName: z.string(),
  role: platformRoleSchema,
});
export type PlatformStaffRef = z.infer<typeof platformStaffRefSchema>;

export const listPlatformStaffResponseSchema = z.object({ items: z.array(platformStaffRefSchema) });
export type ListPlatformStaffResponse = z.infer<typeof listPlatformStaffResponseSchema>;
