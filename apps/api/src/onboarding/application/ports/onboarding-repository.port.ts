import type { OnboardingSetupState } from "@academic-precision/database";

/**
 * Port for onboarding-status derivation. Kept as an interface + Symbol
 * token so the service depends on shape, not on the drizzle repository —
 * lets unit tests plug in a hand-written fake per the codebase's existing
 * `__fixtures__` convention.
 */
export interface OnboardingRepositoryPort {
  loadSetupState(workspaceId: string): Promise<OnboardingSetupState>;
}

export const ONBOARDING_REPOSITORY = Symbol("ONBOARDING_REPOSITORY");
