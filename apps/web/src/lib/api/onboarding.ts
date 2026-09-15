import {
  onboardingStatusResponseSchema,
  type OnboardingStatusResponse,
} from "@academic-precision/contracts";
import { apiRequest } from "./client";

/**
 * `GET /onboarding/status` — fetch the workspace's guided-setup progress.
 *
 * Parsed through the contract schema instead of a bare cast: an old
 * response shape (e.g. during a rolling API deploy where a request lands
 * on a pre-4-step pod, or an in-flight client that predates the
 * aggregator rewrite) then fails LOUDLY at fetch time — the query goes
 * into an error state and the launcher hides — rather than silently
 * writing an old-shape object into the cache and blowing up in
 * `PanelContent` when the user opens the sheet.
 */
export async function fetchOnboardingStatus(
  workspaceId: string,
): Promise<OnboardingStatusResponse> {
  const raw = await apiRequest<unknown>("/onboarding/status", { workspaceId });
  return onboardingStatusResponseSchema.parse(raw);
}
