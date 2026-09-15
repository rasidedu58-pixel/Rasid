import { Injectable } from "@nestjs/common";
import {
  loadOnboardingSetupState,
  withRuntimeContext,
  type OnboardingSetupState,
} from "@academic-precision/database";
import { getContext } from "@academic-precision/observability";
import type { OnboardingRepositoryPort } from "../application/ports/onboarding-repository.port";

/**
 * Drizzle-backed implementation of the onboarding port. Every method runs
 * inside `withRuntimeContext({workspaceId})` so the workspace RLS scope
 * (`app.workspace_id`) is set on the same transaction — mirroring the
 * pattern used by `DrizzleActionCenterRepository`.
 */
@Injectable()
export class DrizzleOnboardingRepository implements OnboardingRepositoryPort {
  private runtimeCtx(workspaceId?: string) {
    const ctx = getContext();
    return {
      userId: ctx?.userId,
      workspaceId: workspaceId ?? (ctx?.workspaceId as string | undefined),
    };
  }

  loadSetupState(workspaceId: string): Promise<OnboardingSetupState> {
    return withRuntimeContext(this.runtimeCtx(workspaceId), (db) =>
      loadOnboardingSetupState(db, workspaceId),
    );
  }
}
