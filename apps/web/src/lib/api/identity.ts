import type { MeResponse, OnboardingCompleteRequest, OnboardingCompleteResponse, WorkspaceContextResponse } from "@academic-precision/contracts";
import { apiRequest } from "./client";

export function fetchMe(): Promise<MeResponse> {
  return apiRequest<MeResponse>("/me");
}

export function fetchWorkspaceContext(workspaceId: string): Promise<WorkspaceContextResponse> {
  return apiRequest<WorkspaceContextResponse>(`/me/workspaces/${workspaceId}/context`);
}

export function completeOnboarding(body: OnboardingCompleteRequest): Promise<OnboardingCompleteResponse> {
  return apiRequest<OnboardingCompleteResponse>("/onboarding/complete", { method: "POST", body });
}
