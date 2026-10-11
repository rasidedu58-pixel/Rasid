import type { StudentExamScore, StudentReportResponse } from "@academic-precision/contracts";

/**
 * Pure presentation of the student report's session aggregates. Extracted so
 * the two places that show them (the profile metric strip and the overview
 * tab) say the same thing, and so the rules are testable without rendering.
 *
 * Nothing here derives a new metric or touches the domain's status values —
 * it only stops the UI from collapsing several distinct states into one
 * number.
 */

type HomeworkSummary = StudentReportResponse["sessions"]["homework"];
type ExamSummary = StudentReportResponse["sessions"]["exam"];

/** Every recorded homework state, so a PARTIAL cannot read as "nothing done". */
export function homeworkBreakdownLabel(hw: HomeworkSummary): string {
  const parts = [`${hw.done} منجز`, `${hw.partial} جزئي`, `${hw.notDone} غير منجز`];
  if (hw.noHomework > 0) parts.push(`${hw.noHomework} لا واجب`);
  if (hw.missing > 0) parts.push(`${hw.missing} غير مسجّل`);
  return parts.join(" · ");
}

/** The homework states that represent an ACTUAL assignment (NO_HOMEWORK is not one). */
export function homeworkAssignedTotal(hw: HomeworkSummary): number {
  return hw.done + hw.partial + hw.notDone + hw.missing;
}

/**
 * `18 / 20` — the mark itself. An ABSENT_FROM_EXAM record has no score by
 * schema invariant, so it reads «غياب» and never a zero.
 */
export function formatExamScore(score: number | null, maxScore: number): string {
  if (score == null) return "غياب";
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2))));
  return `${fmt(score)} / ${fmt(maxScore)}`;
}

/**
 * What the profile's «الامتحان» cell shows. It used to be `scored/total` — a
 * COUNT — so a student with one exam read "1/1" and the mark was nowhere on
 * the page. The score is available, so the score is what it shows: the
 * latest one, with the number of exams as context when there is more than
 * one. Counts remain the fallback only when no mark exists at all.
 */
export function examMetric(examScores: StudentExamScore[], exam: ExamSummary): { value: string; sub: string } {
  const scored = examScores.filter((e) => e.status === "SCORED");
  const latest = scored[0];
  if (latest) {
    return {
      value: formatExamScore(latest.score, latest.maxScore),
      sub: scored.length > 1 ? `آخر درجة من ${scored.length} امتحانات` : "الدرجة",
    };
  }
  if (exam.absent > 0) return { value: "غياب", sub: `${exam.absent} غياب عن الامتحان` };
  const total = exam.scored + exam.absent + exam.missing;
  return { value: "—", sub: total > 0 ? "غير مرصود" : "لا امتحانات" };
}
