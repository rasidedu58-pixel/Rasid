import type { OnboardingSetupState } from "@academic-precision/database";
import type { OnboardingRepositoryPort } from "./ports/onboarding-repository.port";
import { OnboardingService } from "./onboarding.service";

/**
 * Unit tests for the derivation itself — the SQL predicates are exercised
 * end-to-end in the integration suite; here we pin the state → status
 * mapping (order, dependency cascade, `nextStep`, `completed`, `allDone`).
 */
describe("OnboardingService", () => {
  function build(state: Partial<OnboardingSetupState>): OnboardingService {
    const full: OnboardingSetupState = {
      operatingMonth: false,
      groupSetup: false,
      students: false,
      sessions: false,
      attendance: false,
      ...state,
    };
    const repo: OnboardingRepositoryPort = { loadSetupState: async () => full };
    return new OnboardingService(repo);
  }

  it("empty workspace → 0/5, Step 1 AVAILABLE, all others LOCKED, nextStep=operatingMonth", async () => {
    const service = build({});
    const res = await service.getStatus("ws-1");
    expect(res.completed).toBe(0);
    expect(res.total).toBe(5);
    expect(res.allDone).toBe(false);
    expect(res.nextStep).toBe("operatingMonth");
    expect(res.steps).toEqual({
      operatingMonth: "AVAILABLE",
      groupSetup: "LOCKED",
      students: "LOCKED",
      sessions: "LOCKED",
      attendance: "LOCKED",
    });
  });

  it("operating month only → 1/5, Step 2 AVAILABLE, rest LOCKED", async () => {
    const service = build({ operatingMonth: true });
    const res = await service.getStatus("ws-1");
    expect(res.completed).toBe(1);
    expect(res.nextStep).toBe("groupSetup");
    expect(res.steps.operatingMonth).toBe("COMPLETED");
    expect(res.steps.groupSetup).toBe("AVAILABLE");
    expect(res.steps.students).toBe("LOCKED");
  });

  it("group setup complete → students AVAILABLE", async () => {
    const service = build({ operatingMonth: true, groupSetup: true });
    const res = await service.getStatus("ws-1");
    expect(res.completed).toBe(2);
    expect(res.nextStep).toBe("students");
    expect(res.steps.students).toBe("AVAILABLE");
    expect(res.steps.sessions).toBe("LOCKED");
  });

  it("students complete → sessions AVAILABLE (generation happens sync after schedule)", async () => {
    const service = build({ operatingMonth: true, groupSetup: true, students: true });
    const res = await service.getStatus("ws-1");
    expect(res.completed).toBe(3);
    expect(res.nextStep).toBe("sessions");
    expect(res.steps.sessions).toBe("AVAILABLE");
  });

  it("sessions generated → attendance AVAILABLE", async () => {
    const service = build({
      operatingMonth: true,
      groupSetup: true,
      students: true,
      sessions: true,
    });
    const res = await service.getStatus("ws-1");
    expect(res.completed).toBe(4);
    expect(res.nextStep).toBe("attendance");
    expect(res.steps.attendance).toBe("AVAILABLE");
  });

  it("attendance recorded → 5/5, allDone=true, nextStep=null", async () => {
    const service = build({
      operatingMonth: true,
      groupSetup: true,
      students: true,
      sessions: true,
      attendance: true,
    });
    const res = await service.getStatus("ws-1");
    expect(res.completed).toBe(5);
    expect(res.allDone).toBe(true);
    expect(res.nextStep).toBe(null);
    for (const status of Object.values(res.steps)) expect(status).toBe("COMPLETED");
  });

  it("historical attendance without a current month never regresses — COMPLETED wins over LOCKED", async () => {
    // A legacy workspace that recorded attendance in an old CURRENT month
    // which has since been archived: raw attendance boolean is still true
    // even though the SQL for steps 1-4 report false for the (now-absent)
    // CURRENT month. The step must remain COMPLETED — never demoted.
    const service = build({ attendance: true });
    const res = await service.getStatus("ws-1");
    expect(res.steps.attendance).toBe("COMPLETED");
    expect(res.steps.operatingMonth).toBe("AVAILABLE");
    expect(res.completed).toBe(1);
    // nextStep still points at the earliest incomplete step in the chain.
    expect(res.nextStep).toBe("operatingMonth");
  });

  it("passes the workspaceId through to the repository verbatim", async () => {
    let seen: string | undefined;
    const repo: OnboardingRepositoryPort = {
      loadSetupState: async (ws: string) => {
        seen = ws;
        return {
          operatingMonth: false,
          groupSetup: false,
          students: false,
          sessions: false,
          attendance: false,
        };
      },
    };
    const service = new OnboardingService(repo);
    await service.getStatus("ws-42");
    expect(seen).toBe("ws-42");
  });
});
