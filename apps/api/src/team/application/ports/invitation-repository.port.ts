import type {
  AcceptInvitationResult,
  CreateInvitationInput,
  InvitationPreview,
  InvitationRow,
} from "@academic-precision/database";

/**
 * Port between the invitations application layer and its persistence. The
 * real `DrizzleInvitationRepository` threads each call through the correct
 * RLS context (`withRuntimeContext`): workspace-scoped for owner management
 * (create/list/revoke), user-scoped for the invitee's preview/accept — where
 * NO workspace context exists because the invitee is not yet a member.
 */
export interface InvitationRepositoryPort {
  createInvitation(input: CreateInvitationInput): Promise<InvitationRow>;
  listInvitations(workspaceId: string): Promise<InvitationRow[]>;
  findInvitationById(invitationId: string): Promise<InvitationRow | undefined>;
  revokeInvitation(invitationId: string): Promise<InvitationRow | undefined>;
  /** Read-only, user-scoped preview by raw-token hash (no workspace context). */
  previewInvitation(tokenHash: string, accepterUserId: string): Promise<InvitationPreview | null>;
  /** Atomic accept by raw-token hash — one transaction, double-accept-safe. */
  acceptInvitation(params: { tokenHash: string; accepterUserId: string }): Promise<AcceptInvitationResult>;
}

export const INVITATION_REPOSITORY = Symbol("INVITATION_REPOSITORY");
