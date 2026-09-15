import { Inject, Injectable } from "@nestjs/common";
import {
  ONBOARDING_STEP_ORDER,
  type OnboardingStatusResponse,
  type OnboardingStepKey,
  type OnboardingStepStatus,
} from "@academic-precision/contracts";
import {
  ONBOARDING_REPOSITORY,
  type OnboardingRepositoryPort,
} from "./ports/onboarding-repository.port";

/**
 * Onboarding-status service — pure derivation. No writes, no side
 * effects; the input is a workspace id, the output is the status
 * response the client renders straight into the launcher.
 *
 * Dependency ordering rules (mirrors the SQL predicates in
 * `packages/database/src/onboarding/setup-status.repository.ts`):
 *   • operatingMonth → groupSetup → students → sessions form a strict
 *     chain: each step is COMPLETED, else AVAILABLE if every prior
 *     step is COMPLETED, else LOCKED.
 *   • attendance sits after `sessions` in the visible order, but its
 *     underlying predicate is workspace-global (per product decision);
 *     the dependency here is still enforced for UI clarity — you can't
 *     "start attendance" if you don't have generated sessions yet.
 *     If the DB layer ever reports `attendance=true` while
 *     `sessions=false` (a historical account that migrated), the raw
 *     boolean is still honoured: COMPLETED wins over LOCKED so the
 *     user never loses credit for real work already done.
 */
@Injectable()
export class OnboardingService {
  constructor(
    @Inject(ONBOARDING_REPOSITORY)
    private readonly repository: OnboardingRepositoryPort,
  ) {}

  async getStatus(workspaceId: string): Promise<OnboardingStatusResponse> {
    const state = await this.repository.loadSetupState(workspaceId);

    // Walk the deterministic step order, tracking whether the dependency
    // chain is still satisfied. A step's raw boolean always wins for
    // COMPLETED (never demote real progress). Otherwise AVAILABLE if
    // the chain is intact so far, else LOCKED.
    const doneFlags: Record<OnboardingStepKey, boolean> = {
      operatingMonth: state.operatingMonth,
      groupSetup: state.groupSetup,
      students: state.students,
      sessions: state.sessions,
      attendance: state.attendance,
    };
    const steps: Record<OnboardingStepKey, OnboardingStepStatus> = {
      operatingMonth: "LOCKED",
      groupSetup: "LOCKED",
      students: "LOCKED",
      sessions: "LOCKED",
      attendance: "LOCKED",
    };
    let chainIntact = true;
    for (const key of ONBOARDING_STEP_ORDER) {
      if (doneFlags[key]) {
        steps[key] = "COMPLETED";
      } else if (chainIntact) {
        steps[key] = "AVAILABLE";
        chainIntact = false;
      } else {
        steps[key] = "LOCKED";
      }
    }

    const completed = ONBOARDING_STEP_ORDER.reduce(
      (acc, key) => (steps[key] === "COMPLETED" ? acc + 1 : acc),
      0,
    );
    const nextStep = ONBOARDING_STEP_ORDER.find((key) => steps[key] !== "COMPLETED") ?? null;

    return {
      completed,
      total: 5,
      steps,
      nextStep,
      allDone: completed === 5,
    };
  }
}
