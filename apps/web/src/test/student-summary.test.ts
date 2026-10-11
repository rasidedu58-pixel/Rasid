import { describe, expect, it } from "vitest";
import type { StudentExamScore, StudentReportResponse } from "@academic-precision/contracts";
import { examMetric, formatExamScore, homeworkAssignedTotal, homeworkBreakdownLabel } from "../lib/student-summary";

type Homework = StudentReportResponse["sessions"]["homework"];
const hw = (o: Partial<Homework> = {}): Homework => ({ done: 0, partial: 0, notDone: 0, noHomework: 0, missing: 0, ...o });
const exam = (o: Partial<StudentReportResponse["sessions"]["exam"]> = {}) => ({ scored: 0, absent: 0, missing: 0, ...o });
const score = (o: Partial<StudentExamScore> = {}): StudentExamScore => ({
  sessionId: "sess-1",
  sessionDate: "2026-08-12T15:00:00Z",
  examName: "اختبار",
  status: "SCORED",
  score: 18,
  maxScore: 20,
  ...o,
});

/**
 * The reported defects: a student with a PARTIAL homework read «0 واجب
 * منجز» with nothing to say otherwise, and the exam cell showed a COUNT of
 * exams while the mark itself was nowhere on the page.
 */
describe("homeworkBreakdownLabel", () => {
  it("shows the partial state instead of collapsing it into 'nothing done'", () => {
    expect(homeworkBreakdownLabel(hw({ partial: 1 }))).toContain("1 جزئي");
    expect(homeworkBreakdownLabel(hw({ partial: 1 }))).toContain("0 منجز");
  });

  it("always names the three real outcomes, in the owner's own order", () => {
    expect(homeworkBreakdownLabel(hw({ done: 3, partial: 1, notDone: 2 }))).toBe("3 منجز · 1 جزئي · 2 غير منجز");
  });

  it("adds the two bookkeeping states only when they actually occurred", () => {
    expect(homeworkBreakdownLabel(hw({ done: 1 }))).not.toContain("لا واجب");
    expect(homeworkBreakdownLabel(hw({ done: 1, noHomework: 2, missing: 1 }))).toContain("2 لا واجب");
    expect(homeworkBreakdownLabel(hw({ done: 1, noHomework: 2, missing: 1 }))).toContain("1 غير مسجّل");
  });

  it("counts only sessions that actually had an assignment — NO_HOMEWORK is not one", () => {
    expect(homeworkAssignedTotal(hw({ done: 1, partial: 1, notDone: 1, missing: 1, noHomework: 5 }))).toBe(4);
  });
});

describe("formatExamScore", () => {
  it("renders the mark against its maximum", () => {
    expect(formatExamScore(18, 20)).toBe("18 / 20");
  });

  it("keeps a fractional mark exact but drops trailing zeros", () => {
    expect(formatExamScore(15.5, 20)).toBe("15.5 / 20");
    expect(formatExamScore(15.0, 20)).toBe("15 / 20");
  });

  it("an absence is «غياب», never a zero score", () => {
    expect(formatExamScore(null, 20)).toBe("غياب");
    expect(formatExamScore(null, 20)).not.toContain("0");
  });
});

describe("examMetric", () => {
  it("shows the MARK for a single exam, not a count", () => {
    expect(examMetric([score()], exam({ scored: 1 }))).toEqual({ value: "18 / 20", sub: "الدرجة" });
  });

  it("shows the latest mark and says how many exams there are", () => {
    const result = examMetric(
      [score({ sessionId: "b", score: 19 }), score({ sessionId: "a", score: 12 })],
      exam({ scored: 2 }),
    );
    expect(result.value).toBe("19 / 20");
    expect(result.sub).toContain("2");
  });

  it("reports an absence when there is no mark to show", () => {
    expect(examMetric([score({ status: "ABSENT_FROM_EXAM", score: null })], exam({ absent: 1 }))).toEqual({
      value: "غياب",
      sub: "1 غياب عن الامتحان",
    });
  });

  it("falls back to a dash — never a fabricated score — when nothing was recorded", () => {
    expect(examMetric([], exam())).toEqual({ value: "—", sub: "لا امتحانات" });
    expect(examMetric([], exam({ missing: 2 }))).toEqual({ value: "—", sub: "غير مرصود" });
  });
});
