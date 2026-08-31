import type {
  AcceptPlatformStaffInvitationResponse,
  ClaimCustomerInvitationResponse,
  CustomerInvitationPreview,
  PlatformStaffInvitationPreview,
} from "@academic-precision/contracts";
import { apiRequest } from "./client";

/**
 * Invitee/customer-facing invitation endpoints — token is the authority
 * (SupabaseAuthGuard only). Used by the standalone accept pages outside the
 * platform-admin shell.
 */

// --- Platform staff invitation ----------------------------------------------
export function previewStaffInvitation(token: string): Promise<PlatformStaffInvitationPreview> {
  return apiRequest<PlatformStaffInvitationPreview>(`/platform-admin/staff-invitations/token/${encodeURIComponent(token)}`);
}

export function acceptStaffInvitation(token: string): Promise<AcceptPlatformStaffInvitationResponse> {
  return apiRequest<AcceptPlatformStaffInvitationResponse>(`/platform-admin/staff-invitations/token/${encodeURIComponent(token)}/accept`, { method: "POST" });
}

// --- Customer onboarding invitation -----------------------------------------
export function previewCustomerInvitation(token: string): Promise<CustomerInvitationPreview> {
  return apiRequest<CustomerInvitationPreview>(`/platform-admin/customer-invitations/token/${encodeURIComponent(token)}`);
}

export function claimCustomerInvitation(token: string): Promise<ClaimCustomerInvitationResponse> {
  return apiRequest<ClaimCustomerInvitationResponse>(`/platform-admin/customer-invitations/token/${encodeURIComponent(token)}/claim`, { method: "POST" });
}
