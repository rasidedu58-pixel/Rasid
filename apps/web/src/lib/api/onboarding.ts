import type { OnboardingStatusResponse } from "@academic-precision/contracts";
import { apiRequest } from "./client";

/**
 * `GET /onboarding/status` — fetch the workspace's guided-setup progress.
 * Response shape is contract-typed; the caller is responsible for
 * providing the `workspaceId` (matches every other read fetcher).
 */
export function fetchOnboardingStatus(workspaceId: string): Promise<OnboardingStatusResponse> {
  return apiRequest<OnboardingStatusResponse>("/onboarding/status", { workspaceId });
}
