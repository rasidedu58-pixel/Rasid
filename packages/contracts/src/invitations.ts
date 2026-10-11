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

/**
 * POST /invitations — owner creates a shareable invite.
 *
 * An invitation no longer expires on a timer. It stays valid until it is
 * accepted or the owner revokes it — the two events that actually mean
 * something. The 7-day clock only ever produced dead links the owner had to
 * recreate, and it was never a security control: the token is 32 random
 * bytes, stored only as a SHA-256 digest, single-use, and revocable at any
 * moment. `expiresInDays` is gone from the request for that reason; the
 * column is kept nullable so a future policy can reintroduce a deadline
 * without another schema change.
 */
export const createInvitationRequestSchema = z.object({
  /** Pre-authorized grants applied verbatim on acceptance (same shape the editor sends). */
  grants: z.array(desiredGrantSchema),
  /** Optional owner-facing note ("for whom") — display only. */
  invitedLabel: z.string().trim().min(1).max(120).optional(),
});
export type CreateInvitationRequest = z.infer<typeof createInvitationRequestSchema>;

export const createInvitationResponseSchema = z.object({
  id: z.string().uuid(),
  /** RAW token — returned once; the owner builds the link `/invite/<token>`. */
  token: z.string(),
  status: z.literal("PENDING"),
  /** `null` = no deadline (the default now); an ISO string only for legacy rows. */
  expiresAt: z.string().nullable(),
});
export type CreateInvitationResponse = z.infer<typeof createInvitationResponseSchema>;

/**
 * POST /team/members — the owner creates the member's SIGN-IN CREDENTIALS and
 * their permissions in one step, then hands over the link + email + password.
 *
 * Why this exists: the invite-link-only flow required the invitee to go and
 * register themselves, which for an assistant who is handed a phone is the
 * step that never happens. The owner now decides the account.
 *
 * The password is sent once, to the auth provider, to create the account. It
 * is never stored by Rasid in any form, never returned by any later read, and
 * there is no table that can show it — the owner knows it because they chose
 * it, not because the system can recall it.
 */
export const createTeamMemberRequestSchema = z.object({
  fullName: z.string().trim().min(1, "اسم العضو مطلوب").max(120),
  email: z.string().trim().toLowerCase().email("بريد إلكتروني غير صالح"),
  /** Owner-chosen. Minimum mirrors the signup form so both paths agree. */
  password: z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل").max(72),
  grants: z.array(desiredGrantSchema),
});
export type CreateTeamMemberRequest = z.infer<typeof createTeamMemberRequestSchema>;

export const createTeamMemberResponseSchema = z.object({
  invitationId: z.string().uuid(),
  /** RAW invite token — returned once, for the link the owner shares. */
  token: z.string(),
  email: z.string(),
  /**
   * `CREATED` = a new account was created with the owner's password.
   * `EXISTING` = that email already had an account, so NO new user was made
   * and its password was left untouched — the owner must tell them to sign in
   * with the password they already have.
   */
  account: z.enum(["CREATED", "EXISTING"]),
});
export type CreateTeamMemberResponse = z.infer<typeof createTeamMemberResponseSchema>;

export const invitationStatusSchema = z.enum(["PENDING", "ACCEPTED", "REVOKED"]);
export type InvitationStatus = z.infer<typeof invitationStatusSchema>;

/** One row in the owner's invitations list (never exposes the token/hash). */
export const invitationSummarySchema = z.object({
  id: z.string().uuid(),
  status: invitationStatusSchema,
  invitedLabel: z.string().nullable(),
  roleLabel: z.string(),
  grants: z.array(membershipPermissionSummarySchema),
  /** `null` = no deadline. Legacy rows may still carry one. */
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
  acceptedAt: z.string().nullable(),
  /** Only ever true for a legacy row whose deadline already passed. */
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
  /** `null` = no deadline. */
  expiresAt: z.string().nullable(),
  /** Owner-facing note from the invite ("for whom") — shown so the invitee sees it is meant for them. */
  invitedLabel: z.string().nullable(),
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
