import { z } from "zod";
import { permissionKeySchema } from "./permission-catalog";

/**
 * Team/Permissions contract types — API Contract v1.0 §9.8, Phase 2 scope.
 * Shared between apps/api (producer) and apps/web (consumer).
 */

export const scopeTypeSchema = z.enum(["ALL_GROUPS", "SELECTED_GROUPS"]);
export type ScopeType = z.infer<typeof scopeTypeSchema>;

/** One desired grant in a PATCH .../permissions request body. */
export const desiredGrantSchema = z
  .object({
    permission: permissionKeySchema,
    scope: scopeTypeSchema,
    groupIds: z.array(z.string().uuid()).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.scope === "SELECTED_GROUPS" && (!value.groupIds || value.groupIds.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["groupIds"],
        message: "groupIds is required and non-empty when scope is SELECTED_GROUPS.",
      });
    }
    if (value.scope === "ALL_GROUPS" && value.groupIds && value.groupIds.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["groupIds"],
        message: "groupIds must not be set when scope is ALL_GROUPS.",
      });
    }
  });
export type DesiredGrant = z.infer<typeof desiredGrantSchema>;

export const updateMembershipPermissionsRequestSchema = z.object({
  grants: z.array(desiredGrantSchema),
});
export type UpdateMembershipPermissionsRequest = z.infer<
  typeof updateMembershipPermissionsRequestSchema
>;

export const membershipPermissionSummarySchema = z.object({
  permission: permissionKeySchema,
  scope: scopeTypeSchema,
  groupIds: z.array(z.string().uuid()).optional(),
});

export const updateMembershipPermissionsResponseSchema = z.object({
  membershipId: z.string().uuid(),
  permissions: z.array(membershipPermissionSummarySchema),
});
export type UpdateMembershipPermissionsResponse = z.infer<
  typeof updateMembershipPermissionsResponseSchema
>;

/**
 * GET /team — the workspace's members with basic identity and their current
 * effective grant summary. Identity (`fullName`/`email`/`phone`) is readable
 * cross-member only via migration 0053's workspace-co-member RLS policy on
 * `users`; any field the caller cannot see comes back null. `grants` is the
 * member's own stored grant summary (empty for the owner, who is `isOwner`
 * and holds everything implicitly).
 */
export const teamMemberSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  roleLabel: z.string(),
  status: z.enum(["INVITED", "ACTIVE", "DISABLED"]),
  isOwner: z.boolean(),
  fullName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  joinedAt: z.string(),
  disabledAt: z.string().nullable(),
  grants: z.array(membershipPermissionSummarySchema),
});
export type TeamMember = z.infer<typeof teamMemberSchema>;

export const listTeamResponseSchema = z.object({
  members: z.array(teamMemberSchema),
});
export type ListTeamResponse = z.infer<typeof listTeamResponseSchema>;

export const disableMembershipResponseSchema = z.object({
  membershipId: z.string().uuid(),
  status: z.literal("DISABLED"),
  disabledAt: z.string(),
});
export type DisableMembershipResponse = z.infer<typeof disableMembershipResponseSchema>;

export const enableMembershipResponseSchema = z.object({
  membershipId: z.string().uuid(),
  status: z.literal("ACTIVE"),
});
export type EnableMembershipResponse = z.infer<typeof enableMembershipResponseSchema>;
