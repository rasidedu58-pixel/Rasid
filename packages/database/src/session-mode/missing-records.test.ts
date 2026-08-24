import { describe, expect, it } from "vitest";
import { deriveMissingRecords } from "./missing-records";

describe("deriveMissingRecords (Phase 5's single source of truth, extracted for Phase 9 reuse)", () => {
  it("flags ATTENDANCE and HOMEWORK as missing when both are NULL", () => {
    const result = deriveMissingRecords({
      eligibleEnrollmentIds: ["e1"],
      recordsByEnrollmentId: new Map([["e1", { attendanceStatus: null, homeworkStatus: null }]]),
      studentNameByEnrollmentId: new Map([["e1", "أحمد"]]),
    });
    expect(result.missingRecords).toEqual([{ enrollmentId: "e1", studentName: "أحمد", missing: ["ATTENDANCE", "HOMEWORK"] }]);
    expect(result.attendanceSummary.missing).toBe(1);
    expect(result.homeworkSummary.missing).toBe(1);
  });

  it("no record row at all (never taken) is the SAME as NULL fields — also missing", () => {
    const result = deriveMissingRecords({
      eligibleEnrollmentIds: ["e1"],
      recordsByEnrollmentId: new Map(),
      studentNameByEnrollmentId: new Map([["e1", "سارة"]]),
    });
    expect(result.missingRecords).toHaveLength(1);
    expect(result.missingRecords[0]!.missing).toEqual(["ATTENDANCE", "HOMEWORK"]);
  });

  it("NO_HOMEWORK is a RESOLVED state, not missing", () => {
    const result = deriveMissingRecords({
      eligibleEnrollmentIds: ["e1"],
      recordsByEnrollmentId: new Map([["e1", { attendanceStatus: "PRESENT", homeworkStatus: "NO_HOMEWORK" }]]),
      studentNameByEnrollmentId: new Map([["e1", "أحمد"]]),
    });
    expect(result.missingRecords).toHaveLength(0);
    expect(result.homeworkSummary.noHomework).toBe(1);
    expect(result.homeworkSummary.missing).toBe(0);
  });

  it("a fully-recorded enrollment (PRESENT + DONE) produces no missing entry", () => {
    const result = deriveMissingRecords({
      eligibleEnrollmentIds: ["e1"],
      recordsByEnrollmentId: new Map([["e1", { attendanceStatus: "PRESENT", homeworkStatus: "DONE" }]]),
      studentNameByEnrollmentId: new Map([["e1", "أحمد"]]),
    });
    expect(result.missingRecords).toHaveLength(0);
  });

  it("only ABSENT for attendance (no homework gap) flags ATTENDANCE alone as missing is WRONG — ABSENT is resolved, not missing", () => {
    const result = deriveMissingRecords({
      eligibleEnrollmentIds: ["e1"],
      recordsByEnrollmentId: new Map([["e1", { attendanceStatus: "ABSENT", homeworkStatus: "DONE" }]]),
      studentNameByEnrollmentId: new Map([["e1", "أحمد"]]),
    });
    expect(result.missingRecords).toHaveLength(0);
    expect(result.attendanceSummary.absent).toBe(1);
  });

  it("mixed roster: only enrollments with an actual gap appear in missingRecords", () => {
    const result = deriveMissingRecords({
      eligibleEnrollmentIds: ["e1", "e2", "e3"],
      recordsByEnrollmentId: new Map([
        ["e1", { attendanceStatus: "PRESENT", homeworkStatus: "DONE" }],
        ["e2", { attendanceStatus: null, homeworkStatus: "DONE" }],
        ["e3", { attendanceStatus: "PRESENT", homeworkStatus: null }],
      ]),
      studentNameByEnrollmentId: new Map([
        ["e1", "طالب 1"],
        ["e2", "طالب 2"],
        ["e3", "طالب 3"],
      ]),
    });
    expect(result.missingRecords.map((m) => m.enrollmentId)).toEqual(["e2", "e3"]);
    expect(result.missingRecords.find((m) => m.enrollmentId === "e2")!.missing).toEqual(["ATTENDANCE"]);
    expect(result.missingRecords.find((m) => m.enrollmentId === "e3")!.missing).toEqual(["HOMEWORK"]);
  });
});
