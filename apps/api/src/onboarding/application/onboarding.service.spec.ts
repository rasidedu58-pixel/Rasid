import type { OnboardingSetupState } from "@academic-precision/database";
import type { OnboardingRepositoryPort } from "./ports/onboarding-repository.port";
import { OnboardingService } from "./onboarding.service";

/**
 * Unit tests for the derivation itself — the SQL predicates are exercised
 * end-to-end in the integration suite. Here we pin the state → status
 * mapping (order, dependency cascade, `nextStep`, `completed`, `allDone`)
 * and the four visible UX steps derived from five raw signals.
 */
describe("OnboardingService", () => {
  function build(state: Partial<OnboardingSetupState>): OnboardingService {
    const full: OnboardingSetupState = {
      groupExists: false,
      operatingMonthPrepared: false,
      studentsEnrolled: false,
      sessionsGenerated: false,
      attendanceRecorded: false,
      ...state,
    };
    const repo: OnboardingRepositoryPort = { loadSetupState: async () => full };
    return new OnboardingService(repo);
  }

  it("empty workspace → 0/4, createGroup AVAILABLE, all others LOCKED, nextStep=createGroup", async () => {
    const service = build({});
    const res = await service.getStatus("ws-1");
    expect(res.completed).toBe(0);
    expect(res.total).toBe(4);
    expect(res.allDone).toBe(false);
    expect(res.nextStep).toBe("createGroup");
    expect(res.steps).toEqual({
      createGroup: "AVAILABLE",
      prepareMonth: "LOCKED",
      enrollStudents: "LOCKED",
      recordAttendance: "LOCKED",
    });
    expect(res.rawStates).toEqual({
      groupExists: false,
      operatingMonthPrepared: false,
      studentsEnrolled: false,
      sessionsGenerated: false,
      attendanceRecorded: false,
    });
  });

  it("group exists + no CURRENT month → Step 1 COMPLETED, Step 2 AVAILABLE (the exact case the owner flagged)", async () => {
    // Regression guard for the previous UX bug: the user created a
    // durable Group but never opened /months/new. In the old design
    // the checklist would show "أنشئ أول مجموعة" as still incomplete
    // because the predicate joined the CURRENT month. With the new
    // raw signal `groupExists`, Step 1 flips COMPLETED the moment the
    // group row is written, independently of any month.
    const service = build({ groupExists: true });
    const res = await service.getStatus("ws-1");
    expect(res.completed).toBe(1);
    expect(res.nextStep).toBe("prepareMonth");
    expect(res.steps).toEqual({
      createGroup: "COMPLETED",
      prepareMonth: "AVAILABLE",
      enrollStudents: "LOCKED",
      recordAttendance: "LOCKED",
    });
    expect(res.rawStates.groupExists).toBe(true);
    expect(res.rawStates.operatingMonthPrepared).toBe(false);
  });

  it("CURRENT month exists but schedule/group_month incomplete → prepareMonth stays not-complete", async () => {
    // The predicate for `operatingMonthPrepared` requires ALL of:
    // CURRENT month + group_month bound to it + schedule_rules for
    // that group_month. If any leg is missing (e.g. the month row
    // exists but no group_month was inserted), the aggregator returns
    // operatingMonthPrepared=false even if the group exists.
    const service = build({ groupExists: true, operatingMonthPrepared: false });
    const res = await service.getStatus("ws-1");
    expect(res.steps.prepareMonth).toBe("AVAILABLE");
    expect(res.steps.enrollStudents).toBe("LOCKED");
    expect(res.rawStates.operatingMonthPrepared).toBe(false);
  });

  it("month + schedule complete AND sessions generated (same txn) → prepareMonth COMPLETED + confidence raw signal on", async () => {
    // POST /months confirm and prepare-current-month both write
    // group_months + schedule_rules + GENERATED sessions in ONE
    // transaction. So the moment prepareMonth flips COMPLETED, the
    // raw `sessionsGenerated` also becomes true — the client uses this
    // to render the confidence line under Step 2 rather than promote
    // sessions to a task.
    const service = build({
      groupExists: true,
      operatingMonthPrepared: true,
      sessionsGenerated: true,
    });
    const res = await service.getStatus("ws-1");
    expect(res.completed).toBe(2);
    expect(res.nextStep).toBe("enrollStudents");
    expect(res.steps.prepareMonth).toBe("COMPLETED");
    expect(res.rawStates.sessionsGenerated).toBe(true);
  });

  it("student row exists in the workspace but no ACTIVE enrollment on the CURRENT month → enrollStudents stays not-complete", async () => {
    // A bare workspace-level Student (no enrollment) does NOT count
    // — the predicate is on the enrollments table, not students. This
    // matches the schema comment at packages/database/src/schema/
    // students.ts:5-12: group membership lives entirely on enrollments.
    // NB: the setup-state loader does not track a "student rows exist"
    // signal at all — it queries enrollments directly. So the raw
    // `studentsEnrolled` boolean captures the correct thing.
    const service = build({
      groupExists: true,
      operatingMonthPrepared: true,
      sessionsGenerated: true,
      studentsEnrolled: false,
    });
    const res = await service.getStatus("ws-1");
    expect(res.steps.enrollStudents).toBe("AVAILABLE");
    expect(res.steps.recordAttendance).toBe("LOCKED");
    expect(res.rawStates.studentsEnrolled).toBe(false);
  });

  it("enrolled student → enrollStudents COMPLETED, recordAttendance AVAILABLE", async () => {
    const service = build({
      groupExists: true,
      operatingMonthPrepared: true,
      sessionsGenerated: true,
      studentsEnrolled: true,
    });
    const res = await service.getStatus("ws-1");
    expect(res.completed).toBe(3);
    expect(res.nextStep).toBe("recordAttendance");
    expect(res.steps.enrollStudents).toBe("COMPLETED");
    expect(res.steps.recordAttendance).toBe("AVAILABLE");
  });

  it("first attendance recorded → 4/4, allDone=true, nextStep=null", async () => {
    const service = build({
      groupExists: true,
      operatingMonthPrepared: true,
      sessionsGenerated: true,
      studentsEnrolled: true,
      attendanceRecorded: true,
    });
    const res = await service.getStatus("ws-1");
    expect(res.completed).toBe(4);
    expect(res.allDone).toBe(true);
    expect(res.nextStep).toBe(null);
    for (const status of Object.values(res.steps)) expect(status).toBe("COMPLETED");
  });

  it("historical attendance without a current month never regresses — COMPLETED wins over LOCKED", async () => {
    // Legacy workspace: recorded attendance in an old CURRENT month
    // that has since been archived. The other four predicates are
    // false (no CURRENT month means no join hits), but the raw
    // attendanceRecorded boolean stays true. The step must NOT be
    // demoted — real past work is preserved.
    const service = build({ attendanceRecorded: true });
    const res = await service.getStatus("ws-1");
    expect(res.steps.recordAttendance).toBe("COMPLETED");
    expect(res.steps.createGroup).toBe("AVAILABLE");
    expect(res.completed).toBe(1);
    // nextStep still points at the earliest incomplete step.
    expect(res.nextStep).toBe("createGroup");
  });

  it("month prepared without a group existing raw signal is impossible in-domain, but derivation still handles it — chain wins for AVAILABLE placement, raw COMPLETED wins for status", async () => {
    // Defensive test: if a caller ever manufactures state where a
    // deeper raw signal is on while an earlier one is off (e.g. a
    // partial migration on an old workspace), COMPLETED still wins
    // for the deeper step's status. The earliest incomplete raw is
    // AVAILABLE; the ones in between that are still false are LOCKED
    // (chain broken).
    const service = build({
      groupExists: false,
      operatingMonthPrepared: true,
      studentsEnrolled: false,
      attendanceRecorded: false,
    });
    const res = await service.getStatus("ws-1");
    expect(res.steps.createGroup).toBe("AVAILABLE");
    expect(res.steps.prepareMonth).toBe("COMPLETED");
    expect(res.steps.enrollStudents).toBe("LOCKED");
    expect(res.steps.recordAttendance).toBe("LOCKED");
    // completed counts truly-COMPLETED steps only.
    expect(res.completed).toBe(1);
  });

  it("passes the workspaceId through to the repository verbatim", async () => {
    let seen: string | undefined;
    const repo: OnboardingRepositoryPort = {
      loadSetupState: async (ws: string) => {
        seen = ws;
        return {
          groupExists: false,
          operatingMonthPrepared: false,
          studentsEnrolled: false,
          sessionsGenerated: false,
          attendanceRecorded: false,
        };
      },
    };
    const service = new OnboardingService(repo);
    await service.getStatus("ws-42");
    expect(seen).toBe("ws-42");
  });
});
