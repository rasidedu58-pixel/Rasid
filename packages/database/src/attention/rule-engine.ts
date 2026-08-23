/**
 * Deterministic, explainable Attention rule engine — Phase 7. Pure
 * functions only (no DB access), mirroring `scheduling/proration.ts`/
 * `session-mode/roster.ts`/`finance/due-date.ts`'s own convention so this
 * is independently unit-testable.
 *
 * "V1 Rule-based لا AI" (PRD §12) — every rule below is a literal,
 * numerically-specified condition from the approved PRD §12 rule table.
 * `exam.drop` is NOT implemented (Open Question P1, feature flag disabled
 * by default, no approved mathematical definition — see PRD §46) and must
 * never be added here without a product decision.
 *
 * Every match carries its own Evidence candidates so the case is always
 * explainable — the reason and the exact records that produced it are
 * both rendered to the user, never a hidden score.
 */

export type RuleKey =
  | "absence.consecutive"
  | "absence.frequency"
  | "homework.consecutive"
  | "homework.frequency"
  | "exam.low"
  | "combined.medium";

export type Severity = "MEDIUM" | "HIGH";

export interface RuleEngineSessionRecordInput {
  sessionId: string;
  /** Session's own scheduled_at — the ordering key for "consecutive"/"last N" (chronological, not insertion order). */
  scheduledAt: Date;
  attendanceStatus: "PRESENT" | "ABSENT" | "LATE" | null;
  homeworkStatus: "DONE" | "PARTIAL" | "NOT_DONE" | "NO_HOMEWORK" | null;
  examStatus: "NO_EXAM" | "SCORED" | "ABSENT_FROM_EXAM";
  examScore: number | null;
  /**
   * Per-EXAM configured threshold (`session_exams.low_score_threshold` —
   * Phase 5 schema, NOT a GroupMonth-level setting, per explicit
   * correction). `null` = rule disabled for this specific exam; never
   * invent a default.
   */
  examLowScoreThreshold: number | null;
}

export interface EvidenceCandidate {
  sourceType: "SESSION_RECORD" | "SESSION";
  sourceId: string;
  observedAt: Date;
  snapshot: Record<string, unknown>;
}

export interface RuleMatch {
  ruleKey: RuleKey;
  severity: Severity;
  evidence: EvidenceCandidate[];
}

function sortedByScheduledAt(records: RuleEngineSessionRecordInput[]): RuleEngineSessionRecordInput[] {
  return [...records].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
}

/** absence.consecutive — "غياب حصتين متتاليتين" (2 consecutive absences). Only RESOLVED attendance records form the sequence — a missing/draft record (null) is not evidence of anything and does not count as a break or a hit. */
function evaluateAbsenceConsecutive(records: RuleEngineSessionRecordInput[]): RuleMatch | undefined {
  const resolved = sortedByScheduledAt(records).filter((r) => r.attendanceStatus !== null);
  const lastTwo = resolved.slice(-2);
  if (lastTwo.length < 2 || !lastTwo.every((r) => r.attendanceStatus === "ABSENT")) return undefined;
  return {
    ruleKey: "absence.consecutive",
    severity: "MEDIUM",
    evidence: lastTwo.map((r) => toEvidence(r, { attendanceStatus: r.attendanceStatus })),
  };
}

/** absence.frequency — "3 من آخر 5 eligible sessions" (3 of the last 5 resolved sessions). */
function evaluateAbsenceFrequency(records: RuleEngineSessionRecordInput[]): RuleMatch | undefined {
  const resolved = sortedByScheduledAt(records).filter((r) => r.attendanceStatus !== null);
  const lastFive = resolved.slice(-5);
  if (lastFive.length < 5) return undefined;
  const absences = lastFive.filter((r) => r.attendanceStatus === "ABSENT");
  if (absences.length < 3) return undefined;
  return {
    ruleKey: "absence.frequency",
    severity: "MEDIUM",
    evidence: absences.map((r) => toEvidence(r, { attendanceStatus: r.attendanceStatus, windowSize: 5 })),
  };
}

/** homework.consecutive — "لم يؤد مرتين متتاليتين" (NOT_DONE twice consecutively). NO_HOMEWORK sessions are skipped from the sequence entirely (no homework was ever assigned — neither a hit nor a break), same reasoning as the missing-record skip above. */
function evaluateHomeworkConsecutive(records: RuleEngineSessionRecordInput[]): RuleMatch | undefined {
  const relevant = sortedByScheduledAt(records).filter(
    (r) => r.homeworkStatus !== null && r.homeworkStatus !== "NO_HOMEWORK",
  );
  const lastTwo = relevant.slice(-2);
  if (lastTwo.length < 2 || !lastTwo.every((r) => r.homeworkStatus === "NOT_DONE")) return undefined;
  return {
    ruleKey: "homework.consecutive",
    severity: "MEDIUM",
    evidence: lastTwo.map((r) => toEvidence(r, { homeworkStatus: r.homeworkStatus })),
  };
}

/** homework.frequency — "مقصر/لم يؤد في 3 من آخر 4" (PARTIAL or NOT_DONE in 3 of the last 4 relevant sessions). */
function evaluateHomeworkFrequency(records: RuleEngineSessionRecordInput[]): RuleMatch | undefined {
  const relevant = sortedByScheduledAt(records).filter(
    (r) => r.homeworkStatus !== null && r.homeworkStatus !== "NO_HOMEWORK",
  );
  const lastFour = relevant.slice(-4);
  if (lastFour.length < 4) return undefined;
  const shortfalls = lastFour.filter((r) => r.homeworkStatus === "PARTIAL" || r.homeworkStatus === "NOT_DONE");
  if (shortfalls.length < 3) return undefined;
  return {
    ruleKey: "homework.frequency",
    severity: "MEDIUM",
    evidence: shortfalls.map((r) => toEvidence(r, { homeworkStatus: r.homeworkStatus, windowSize: 4 })),
  };
}

/**
 * exam.low — "درجتان متتاليتان من امتحانين مؤهلين متتاليين كل منهما تحت
 * threshold الخاصة به" (two consecutive scores, each below ITS OWN exam's
 * threshold). An exam with no configured `examLowScoreThreshold` is simply
 * not eligible for this rule (never defaulted); `ABSENT_FROM_EXAM` is
 * never treated as a low score or as 0 — it is excluded from the sequence
 * entirely, same as a missing record.
 */
function evaluateExamLow(records: RuleEngineSessionRecordInput[]): RuleMatch | undefined {
  const eligible = sortedByScheduledAt(records).filter(
    (r) => r.examStatus === "SCORED" && r.examScore !== null && r.examLowScoreThreshold !== null,
  );
  const lastTwo = eligible.slice(-2);
  if (lastTwo.length < 2) return undefined;
  const bothLow = lastTwo.every((r) => (r.examScore as number) < (r.examLowScoreThreshold as number));
  if (!bothLow) return undefined;
  return {
    ruleKey: "exam.low",
    severity: "MEDIUM",
    evidence: lastTwo.map((r) => toEvidence(r, { examScore: r.examScore, threshold: r.examLowScoreThreshold })),
  };
}

function toEvidence(record: RuleEngineSessionRecordInput, extra: Record<string, unknown>): EvidenceCandidate {
  return {
    sourceType: "SESSION_RECORD",
    sourceId: record.sessionId,
    observedAt: record.scheduledAt,
    snapshot: { sessionId: record.sessionId, scheduledAt: record.scheduledAt.toISOString(), ...extra },
  };
}

/**
 * Evaluates all 5 base rules for one Group's session-record history for one
 * Student, plus `combined.medium` (fires when 2+ of the base MEDIUM rules
 * match together — PRD §12: "عدة مؤشرات متوسطة" → "سبب موحد/priority
 * أعلى"; the exact count for "several" is not given numerically anywhere
 * in the docs, so 2 is the minimal, non-inflated reading of "several ≥
 * two"). `combined.medium` is ADDITIONAL, never a replacement — the
 * individual reasons stay fully visible/explainable in their own right.
 *
 * Records passed in MUST already be scoped to a single Group (via its
 * GroupMonth chain) — this function has no group awareness of its own; the
 * caller (attention.repository.ts) is responsible for partitioning a
 * student's session_records by group before calling this, which is
 * exactly what keeps reasons/evidence group-aware end to end.
 */
export function evaluateRulesForGroup(records: RuleEngineSessionRecordInput[]): RuleMatch[] {
  const baseMatches = [
    evaluateAbsenceConsecutive(records),
    evaluateAbsenceFrequency(records),
    evaluateHomeworkConsecutive(records),
    evaluateHomeworkFrequency(records),
    evaluateExamLow(records),
  ].filter((m): m is RuleMatch => m !== undefined);

  const matches = [...baseMatches];

  if (baseMatches.length >= 2) {
    matches.push({
      ruleKey: "combined.medium",
      severity: "HIGH",
      evidence: baseMatches.flatMap((m) => m.evidence),
    });
  }

  return matches;
}

/**
 * Priority a caller is allowed to SEE, computed only from the Reasons they
 * themselves have Group Scope over — never from the Case's full/internal
 * priority (§ Attention Case + multi-group security correction: "priority
 * المعروضة للمستخدم المحدود تُحسب من الأسباب التي يستطيع رؤيتها، ولا تكشف
 * ضمنيًا وجود مشكلة أعلى في مجموعة أخرى"). Returns `undefined` when the
 * caller has no visible Reasons at all — the caller (service layer) must
 * treat that as "case not found" (safe no-leak), never render an empty
 * case.
 */
export function computeVisiblePriority(visibleReasons: Array<{ severity: Severity }>): Severity | undefined {
  if (visibleReasons.length === 0) return undefined;
  return visibleReasons.some((r) => r.severity === "HIGH") ? "HIGH" : "MEDIUM";
}
