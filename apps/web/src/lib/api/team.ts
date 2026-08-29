import type { ListTeamResponse, UpdateMembershipPermissionsRequest, UpdateMembershipPermissionsResponse, DisableMembershipResponse, EnableMembershipResponse } from "@academic-precision/contracts";
import { apiRequest } from "./client";

export function fetchTeam(workspaceId: string): Promise<ListTeamResponse> {
  return apiRequest<ListTeamResponse>("/team", { workspaceId });
}

export function updateMembershipPermissions(workspaceId: string, membershipId: string, body: UpdateMembershipPermissionsRequest): Promise<UpdateMembershipPermissionsResponse> {
  return apiRequest<UpdateMembershipPermissionsResponse>(`/memberships/${membershipId}/permissions`, { method: "PATCH", workspaceId, body });
}

export function disableMembership(workspaceId: string, membershipId: string): Promise<DisableMembershipResponse> {
  return apiRequest<DisableMembershipResponse>(`/memberships/${membershipId}/disable`, { method: "POST", workspaceId });
}

export function enableMembership(workspaceId: string, membershipId: string): Promise<EnableMembershipResponse> {
  return apiRequest<EnableMembershipResponse>(`/memberships/${membershipId}/enable`, { method: "POST", workspaceId });
}
