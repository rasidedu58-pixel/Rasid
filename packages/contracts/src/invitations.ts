import { z } from "zod";
import { permissionKeySchema } from "./permission-catalog";
import { desiredGrantSchema, membershipPermissionSummarySchema } from "./team";

/**
 * Team & Permissions Phase 2 — invitation-link contract types. An owner
 * creates an invitation bound to a role + permission scope; the API returns a
 * high-entropy raw token EXACTLY ONCE (only its hash is stored) for the owner
 * to share as a link. Opening the link lets the invitee accept, which creates
 * their ACTIVE membership atomically. Shared between apps/api and apps/web.
 */

/** POST /invitations — owner creates a shareable invite. */
export const createInvitationRequestSchema = z.object({
  /** Pre-authorized grants applied verbatim on acceptance (same shape the editor sends). */
  grants: z.array(desiredGrantSchema),
  /** Link lifetime in days (1–30). Defaults server-side when omitted. */
  expiresInDays: z.number().int().min(1).max(30).optional(),
  /** Optional owner-facing note ("for whom") — display only. */
  invitedLabel: z.string().trim().min(1).max(120).optional(),
});
export type CreateInvitationRequest = z.infer<typeof createInvitationRequestSchema>;

export const createInvitationResponseSchema = z.object({
  id: z.string().uuid(),
  /** RAW token — returned once; the owner builds the link `/invite/<token>`. */
  token: z.string(),
  status: z.literal("PENDING"),
  expiresAt: z.string(),
});
export type CreateInvitationResponse = z.infer<typeof createInvitationResponseSchema>;

export const invitationStatusSchema = z.enum(["PENDING", "ACCEPTED", "REVOKED"]);
export type InvitationStatus = z.infer<typeof invitationStatusSchema>;

/** One row in the owner's invitations list (never exposes the token/hash). */
export const invitationSummarySchema = z.object({
  id: z.string().uuid(),
  status: invitationStatusSchema,
  invitedLabel: z.string().nullable(),
  roleLabel: z.string(),
  grants: z.array(membershipPermissionSummarySchema),
  expiresAt: z.string(),
  createdAt: z.string(),
  acceptedAt: z.string().nullable(),
  /** True once `expiresAt` is in the past (PENDING-but-expired renders distinctly). */
  expired: z.boolean(),
});
export type InvitationSummary = z.infer<typeof invitationSummarySchema>;

export const listInvitationsResponseSchema = z.object({
  invitations: z.array(invitationSummarySchema),
});
export type ListInvitationsResponse = z.infer<typeof listInvitationsResponseSchema>;

export const revokeInvitationResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.literal("REVOKED"),
});
export type RevokeInvitationResponse = z.infer<typeof revokeInvitationResponseSchema>;

/**
 * GET /invitations/token/:token — read-only preview for the accept page. Safe
 * for any authenticated user holding the (high-entropy) token; reveals only
 * what is needed to decide whether to accept.
 */
export const invitationPreviewResponseSchema = z.object({
  status: invitationStatusSchema,
  /** PENDING and unexpired — the accept button is only enabled when true. */
  valid: z.boolean(),
  /** The workspace the invite is for — used to make it the caller's current workspace on accept. */
  workspaceId: z.string().uuid(),
  workspaceName: z.string().nullable(),
  expiresAt: z.string(),
  /** Permission keys the invitee will receive — rendered as a capability list. */
  permissions: z.array(permissionKeySchema),
});
export type InvitationPreviewResponse = z.infer<typeof invitationPreviewResponseSchema>;

export const acceptInvitationResponseSchema = z.object({
  workspaceId: z.string().uuid(),
  membershipId: z.string().uuid(),
  status: z.literal("ACTIVE"),
});
export type AcceptInvitationResponse = z.infer<typeof acceptInvitationResponseSchema>;
