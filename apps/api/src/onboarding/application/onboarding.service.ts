import { Inject, Injectable } from "@nestjs/common";
import {
  ONBOARDING_STEP_ORDER,
  type OnboardingRawStates,
  type OnboardingStatusResponse,
  type OnboardingStepKey,
  type OnboardingStepStatus,
} from "@academic-precision/contracts";
import {
  ONBOARDING_REPOSITORY,
  type OnboardingRepositoryPort,
} from "./ports/onboarding-repository.port";

/**
 * Onboarding-status service — pure derivation.
 *
 * Reads FIVE raw business signals and maps them onto FOUR visible UX
 * steps. `sessionsGenerated` is a raw state but NOT a user task — the
 * client renders a confidence line under `prepareMonth` when it's on.
 *
 * Dependency ordering rules — each step's raw boolean maps 1:1 to its
 * `COMPLETED` status, otherwise `AVAILABLE` if the chain is still
 * intact so far, otherwise `LOCKED`. A step's raw `true` always wins
 * for `COMPLETED` even if the chain has broken (a historical account
 * with attendance but no current month never silently loses credit
 * for real past work).
 */
@Injectable()
export class OnboardingService {
  constructor(
    @Inject(ONBOARDING_REPOSITORY)
    private readonly repository: OnboardingRepositoryPort,
  ) {}

  async getStatus(workspaceId: string): Promise<OnboardingStatusResponse> {
    const state = await this.repository.loadSetupState(workspaceId);

    // The visible checklist uses four UX keys, each backed by ONE raw
    // signal (never a compound). `sessionsGenerated` stays raw only.
    const doneFlags: Record<OnboardingStepKey, boolean> = {
      createGroup: state.groupExists,
      prepareMonth: state.operatingMonthPrepared,
      enrollStudents: state.studentsEnrolled,
      recordAttendance: state.attendanceRecorded,
    };

    const steps: Record<OnboardingStepKey, OnboardingStepStatus> = {
      createGroup: "LOCKED",
      prepareMonth: "LOCKED",
      enrollStudents: "LOCKED",
      recordAttendance: "LOCKED",
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

    const rawStates: OnboardingRawStates = {
      groupExists: state.groupExists,
      operatingMonthPrepared: state.operatingMonthPrepared,
      studentsEnrolled: state.studentsEnrolled,
      sessionsGenerated: state.sessionsGenerated,
      attendanceRecorded: state.attendanceRecorded,
    };

    return {
      completed,
      total: 4,
      steps,
      nextStep,
      allDone: completed === 4,
      rawStates,
    };
  }
}
