import type {
  AcceptInvitationResponse,
  CreateInvitationRequest,
  CreateInvitationResponse,
  InvitationPreviewResponse,
  ListInvitationsResponse,
  RevokeInvitationResponse,
} from "@academic-precision/contracts";
import { apiRequest } from "./client";

/** Owner-facing (workspace-scoped). */
export function createInvitation(workspaceId: string, body: CreateInvitationRequest): Promise<CreateInvitationResponse> {
  return apiRequest<CreateInvitationResponse>("/invitations", { method: "POST", workspaceId, body });
}

export function listInvitations(workspaceId: string): Promise<ListInvitationsResponse> {
  return apiRequest<ListInvitationsResponse>("/invitations", { workspaceId });
}

export function revokeInvitation(workspaceId: string, invitationId: string): Promise<RevokeInvitationResponse> {
  return apiRequest<RevokeInvitationResponse>(`/invitations/${invitationId}/revoke`, { method: "POST", workspaceId });
}

/**
 * Invitee-facing (authenticated, NO workspace header — the invitee is not yet
 * a member). The raw token lives in the path.
 */
export function previewInvitation(token: string): Promise<InvitationPreviewResponse> {
  return apiRequest<InvitationPreviewResponse>(`/invitations/token/${encodeURIComponent(token)}`);
}

export function acceptInvitation(token: string): Promise<AcceptInvitationResponse> {
  return apiRequest<AcceptInvitationResponse>(`/invitations/token/${encodeURIComponent(token)}/accept`, {
    method: "POST",
  });
}
