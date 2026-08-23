import { describe, expect, it } from "vitest";
import { computeVisiblePriority, evaluateRulesForGroup, type RuleEngineSessionRecordInput } from "./rule-engine";

function record(partial: Partial<RuleEngineSessionRecordInput> & { sessionId: string; scheduledAt: Date }): RuleEngineSessionRecordInput {
  return {
    attendanceStatus: null,
    homeworkStatus: null,
    examStatus: "NO_EXAM",
    examScore: null,
    examLowScoreThreshold: null,
    ...partial,
  };
}

const day = (n: number) => new Date(2026, 7, n); // August 2026

describe("evaluateRulesForGroup", () => {
  it("a single absence never opens a case — no alert for a lone absence", () => {
    const records = [record({ sessionId: "s1", scheduledAt: day(1), attendanceStatus: "PRESENT" }), record({ sessionId: "s2", scheduledAt: day(3), attendanceStatus: "ABSENT" })];
    expect(evaluateRulesForGroup(records)).toEqual([]);
  });

  it("absence.consecutive fires on 2 consecutive resolved absences", () => {
    const records = [
      record({ sessionId: "s1", scheduledAt: day(1), attendanceStatus: "PRESENT" }),
      record({ sessionId: "s2", scheduledAt: day(3), attendanceStatus: "ABSENT" }),
      record({ sessionId: "s3", scheduledAt: day(5), attendanceStatus: "ABSENT" }),
    ];
    const matches = evaluateRulesForGroup(records);
    expect(matches.map((m) => m.ruleKey)).toContain("absence.consecutive");
    const match = matches.find((m) => m.ruleKey === "absence.consecutive")!;
    expect(match.severity).toBe("MEDIUM");
    expect(match.evidence).toHaveLength(2);
  });

  it("a PRESENT session breaks the absence.consecutive streak", () => {
    const records = [
      record({ sessionId: "s1", scheduledAt: day(1), attendanceStatus: "ABSENT" }),
      record({ sessionId: "s2", scheduledAt: day(3), attendanceStatus: "PRESENT" }),
      record({ sessionId: "s3", scheduledAt: day(5), attendanceStatus: "ABSENT" }),
    ];
    expect(evaluateRulesForGroup(records).map((m) => m.ruleKey)).not.toContain("absence.consecutive");
  });

  it("absence.frequency fires on 3-of-last-5 absences, not before the 5th eligible session exists", () => {
    const only4 = [1, 2, 3, 4].map((d) =>
      record({ sessionId: `s${d}`, scheduledAt: day(d), attendanceStatus: d <= 3 ? "ABSENT" : "PRESENT" }),
    );
    expect(evaluateRulesForGroup(only4).map((m) => m.ruleKey)).not.toContain("absence.frequency");

    const with5 = [...only4, record({ sessionId: "s5", scheduledAt: day(5), attendanceStatus: "PRESENT" })];
    expect(evaluateRulesForGroup(with5).map((m) => m.ruleKey)).toContain("absence.frequency");
  });

  it("null (missing/draft) attendance records are skipped, not counted as absence or as a streak-breaker", () => {
    const records = [
      record({ sessionId: "s1", scheduledAt: day(1), attendanceStatus: "ABSENT" }),
      record({ sessionId: "s2", scheduledAt: day(2), attendanceStatus: null }), // draft, not yet taken
      record({ sessionId: "s3", scheduledAt: day(3), attendanceStatus: "ABSENT" }),
    ];
    expect(evaluateRulesForGroup(records).map((m) => m.ruleKey)).toContain("absence.consecutive");
  });

  it("homework.consecutive fires on NOT_DONE twice consecutively; NO_HOMEWORK sessions are skipped, not treated as a break", () => {
    const records = [
      record({ sessionId: "s1", scheduledAt: day(1), homeworkStatus: "NOT_DONE" }),
      record({ sessionId: "s2", scheduledAt: day(2), homeworkStatus: "NO_HOMEWORK" }),
      record({ sessionId: "s3", scheduledAt: day(3), homeworkStatus: "NOT_DONE" }),
    ];
    expect(evaluateRulesForGroup(records).map((m) => m.ruleKey)).toContain("homework.consecutive");
  });

  it("homework.consecutive does NOT fire for PARTIAL (only NOT_DONE counts as 'لم يؤد')", () => {
    const records = [
      record({ sessionId: "s1", scheduledAt: day(1), homeworkStatus: "PARTIAL" }),
      record({ sessionId: "s2", scheduledAt: day(2), homeworkStatus: "PARTIAL" }),
    ];
    expect(evaluateRulesForGroup(records).map((m) => m.ruleKey)).not.toContain("homework.consecutive");
  });

  it("homework.frequency fires on PARTIAL/NOT_DONE in 3 of last 4 relevant sessions", () => {
    const records = [
      record({ sessionId: "s1", scheduledAt: day(1), homeworkStatus: "PARTIAL" }),
      record({ sessionId: "s2", scheduledAt: day(2), homeworkStatus: "NOT_DONE" }),
      record({ sessionId: "s3", scheduledAt: day(3), homeworkStatus: "DONE" }),
      record({ sessionId: "s4", scheduledAt: day(4), homeworkStatus: "PARTIAL" }),
    ];
    expect(evaluateRulesForGroup(records).map((m) => m.ruleKey)).toContain("homework.frequency");
  });

  it("exam.low: two consecutive scores each below their OWN exam's threshold", () => {
    const records = [
      record({ sessionId: "s1", scheduledAt: day(1), examStatus: "SCORED", examScore: 40, examLowScoreThreshold: 50 }),
      record({ sessionId: "s2", scheduledAt: day(2), examStatus: "SCORED", examScore: 45, examLowScoreThreshold: 60 }),
    ];
    const matches = evaluateRulesForGroup(records);
    expect(matches.map((m) => m.ruleKey)).toContain("exam.low");
  });

  it("exam.low never fires for an exam with NO configured threshold — never invents a default", () => {
    const records = [
      record({ sessionId: "s1", scheduledAt: day(1), examStatus: "SCORED", examScore: 10, examLowScoreThreshold: null }),
      record({ sessionId: "s2", scheduledAt: day(2), examStatus: "SCORED", examScore: 5, examLowScoreThreshold: null }),
    ];
    expect(evaluateRulesForGroup(records).map((m) => m.ruleKey)).not.toContain("exam.low");
  });

  it("ABSENT_FROM_EXAM is never treated as a low score or as 0 — excluded from the exam.low sequence entirely", () => {
    const records = [
      record({ sessionId: "s1", scheduledAt: day(1), examStatus: "SCORED", examScore: 40, examLowScoreThreshold: 50 }),
      record({ sessionId: "s2", scheduledAt: day(2), examStatus: "ABSENT_FROM_EXAM", examScore: null, examLowScoreThreshold: 50 }),
      record({ sessionId: "s3", scheduledAt: day(3), examStatus: "SCORED", examScore: 42, examLowScoreThreshold: 50 }),
    ];
    // s2 is skipped, so the "last two" scored+thresholded exams are s1 and s3 — both low → still fires.
    const matches = evaluateRulesForGroup(records);
    expect(matches.map((m) => m.ruleKey)).toContain("exam.low");
    const match = matches.find((m) => m.ruleKey === "exam.low")!;
    expect(match.evidence.map((e) => e.sourceId)).toEqual(["s1", "s3"]);
  });

  it("combined.medium fires when 2+ base rules match together, additively (never replacing the individual reasons)", () => {
    const records = [
      record({ sessionId: "s1", scheduledAt: day(1), attendanceStatus: "ABSENT", homeworkStatus: "NOT_DONE" }),
      record({ sessionId: "s2", scheduledAt: day(2), attendanceStatus: "ABSENT", homeworkStatus: "NOT_DONE" }),
    ];
    const matches = evaluateRulesForGroup(records);
    const ruleKeys = matches.map((m) => m.ruleKey);
    expect(ruleKeys).toContain("absence.consecutive");
    expect(ruleKeys).toContain("homework.consecutive");
    expect(ruleKeys).toContain("combined.medium");
    expect(matches.find((m) => m.ruleKey === "combined.medium")!.severity).toBe("HIGH");
  });

  it("exam.drop is never produced by this engine (not implemented — Open Question, feature flag disabled by default)", () => {
    const records = [
      record({ sessionId: "s1", scheduledAt: day(1), examStatus: "SCORED", examScore: 90, examLowScoreThreshold: 50 }),
      record({ sessionId: "s2", scheduledAt: day(2), examStatus: "SCORED", examScore: 20, examLowScoreThreshold: 50 }),
    ];
    expect(evaluateRulesForGroup(records).map((m) => m.ruleKey)).not.toContain("exam.drop" as never);
  });
});

describe("computeVisiblePriority", () => {
  it("returns undefined for an empty (no visible reasons) set — treated as case-not-found by the caller", () => {
    expect(computeVisiblePriority([])).toBeUndefined();
  });

  it("returns MEDIUM when all visible reasons are MEDIUM", () => {
    expect(computeVisiblePriority([{ severity: "MEDIUM" }, { severity: "MEDIUM" }])).toBe("MEDIUM");
  });

  it("returns HIGH if any visible reason is HIGH — never leaks a higher priority from an invisible reason", () => {
    expect(computeVisiblePriority([{ severity: "MEDIUM" }, { severity: "HIGH" }])).toBe("HIGH");
  });
});
