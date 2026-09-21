import { describe, expect, it } from "vitest";
import {
  ATTENTION_RULE_LABEL,
  attentionCardSubtitle,
  attentionReasonSummary,
  attentionRuleLabel,
  type AttentionReasonDto,
} from "./attention";

describe("attentionRuleLabel — human-readable attention reasons", () => {
  it("maps every engine-emitted rule key to a concrete Arabic reason (never a generic title)", () => {
    // The rule engine at packages/database/src/attention/rule-engine.ts
    // emits these six dotted keys — this pins the label map is in lockstep.
    expect(attentionRuleLabel("absence.consecutive")).toBe("غياب متتالٍ");
    expect(attentionRuleLabel("absence.frequency")).toBe("غياب متكرر");
    expect(attentionRuleLabel("homework.consecutive")).toBe("تقصير متتالٍ في الواجب");
    expect(attentionRuleLabel("homework.frequency")).toBe("تقصير متكرر في الواجب");
    expect(attentionRuleLabel("exam.low")).toBe("درجة امتحان منخفضة");
    expect(attentionRuleLabel("combined.medium")).toBe("تراكم إشارات متابعة");
  });

  it("keeps the legacy UPPER_SNAKE aliases mapping to their human labels", () => {
    // Kept as defensive fallbacks; not emitted by the current engine.
    expect(attentionRuleLabel("ATTENDANCE_ABSENCE_STREAK")).toBe("غياب متكرر");
    expect(attentionRuleLabel("HOMEWORK_NOT_DONE_STREAK")).toBe("تقصير متكرر في الواجب");
    expect(attentionRuleLabel("LOW_EXAM_SCORE")).toBe("درجة امتحان منخفضة");
  });

  it("keeps the label table and the lookup in sync", () => {
    for (const [key, label] of Object.entries(ATTENTION_RULE_LABEL)) {
      expect(attentionRuleLabel(key)).toBe(label);
    }
  });

  it("falls back to an HONEST label for an unknown/absent rule (never a fabricated 'حالة تحتاج متابعة')", () => {
    const fallback = "لم يُسجَّل سبب تفصيلي لهذه الحالة بعد";
    expect(attentionRuleLabel("SOMETHING_NEW")).toBe(fallback);
    expect(attentionRuleLabel(null)).toBe(fallback);
    expect(attentionRuleLabel(undefined)).toBe(fallback);
  });
});

function reason(overrides: Partial<AttentionReasonDto>): AttentionReasonDto {
  return {
    id: "reason-1",
    ruleKey: "absence.frequency",
    severity: "MEDIUM",
    groupId: "00000000-0000-0000-0000-000000000000",
    firstDetectedAt: new Date("2026-09-14T09:00:00Z").toISOString(),
    lastDetectedAt: new Date("2026-09-21T09:00:00Z").toISOString(),
    evidence: [],
    ...overrides,
  };
}

describe("attentionReasonSummary — human sentences from real evidence", () => {
  it("absence.frequency counts only ABSENT evidence rows (never a blind length)", () => {
    const r = reason({
      ruleKey: "absence.frequency",
      evidence: [
        { id: "e1", sourceType: "SESSION_RECORD", sourceId: "s1", observedAt: "2026-09-14T09:00:00Z", snapshot: { attendanceStatus: "ABSENT", windowSize: 5 } },
        { id: "e2", sourceType: "SESSION_RECORD", sourceId: "s2", observedAt: "2026-09-17T09:00:00Z", snapshot: { attendanceStatus: "ABSENT", windowSize: 5 } },
        { id: "e3", sourceType: "SESSION_RECORD", sourceId: "s3", observedAt: "2026-09-21T09:00:00Z", snapshot: { attendanceStatus: "ABSENT", windowSize: 5 } },
      ],
    });
    const s = attentionReasonSummary(r);
    expect(s).toContain("غياب متكرر");
    expect(s).toContain("3 من آخر 5 حصص");
    expect(s).toContain("آخر رصد");
  });

  it("absence.consecutive says N متتالية when at least two absences are captured", () => {
    const r = reason({
      ruleKey: "absence.consecutive",
      evidence: [
        { id: "e1", sourceType: "SESSION_RECORD", sourceId: "s1", observedAt: "2026-09-14T09:00:00Z", snapshot: { attendanceStatus: "ABSENT" } },
        { id: "e2", sourceType: "SESSION_RECORD", sourceId: "s2", observedAt: "2026-09-21T09:00:00Z", snapshot: { attendanceStatus: "ABSENT" } },
      ],
    });
    expect(attentionReasonSummary(r)).toContain("2 حصص متتالية بغياب");
  });

  it("homework.frequency counts NOT_DONE and PARTIAL — never DONE or NO_HOMEWORK", () => {
    const r = reason({
      ruleKey: "homework.frequency",
      evidence: [
        { id: "e1", sourceType: "SESSION_RECORD", sourceId: "s1", observedAt: "2026-09-14T09:00:00Z", snapshot: { homeworkStatus: "NOT_DONE", windowSize: 4 } },
        { id: "e2", sourceType: "SESSION_RECORD", sourceId: "s2", observedAt: "2026-09-17T09:00:00Z", snapshot: { homeworkStatus: "PARTIAL", windowSize: 4 } },
        { id: "e3", sourceType: "SESSION_RECORD", sourceId: "s3", observedAt: "2026-09-21T09:00:00Z", snapshot: { homeworkStatus: "NOT_DONE", windowSize: 4 } },
      ],
    });
    expect(attentionReasonSummary(r)).toContain("3 من آخر 4 حصص");
  });

  it("exam.low surfaces the actual last score without dumping raw JSON", () => {
    const r = reason({
      ruleKey: "exam.low",
      evidence: [
        { id: "e1", sourceType: "SESSION_RECORD", sourceId: "s1", observedAt: "2026-09-14T09:00:00Z", snapshot: { examScore: 3, threshold: 5 } },
        { id: "e2", sourceType: "SESSION_RECORD", sourceId: "s2", observedAt: "2026-09-21T09:00:00Z", snapshot: { examScore: 4, threshold: 5 } },
      ],
    });
    const s = attentionReasonSummary(r);
    expect(s).toContain("درجة امتحان منخفضة");
    expect(s).toContain("آخر درجة 4");
    expect(s).not.toContain("{");
    expect(s).not.toContain("threshold");
  });

  it("falls back to the plain label + date when evidence is empty (never invents a count)", () => {
    const r = reason({ ruleKey: "absence.frequency", evidence: [] });
    const s = attentionReasonSummary(r);
    expect(s).toContain("غياب متكرر");
    expect(s).not.toContain("من آخر");
    expect(s).toContain("آخر رصد");
  });

  it("attentionCardSubtitle returns just the detail (no date suffix) for dashboard-card use", () => {
    const r = reason({
      ruleKey: "absence.frequency",
      evidence: [
        { id: "e1", sourceType: "SESSION_RECORD", sourceId: "s1", observedAt: "2026-09-14T09:00:00Z", snapshot: { attendanceStatus: "ABSENT", windowSize: 5 } },
        { id: "e2", sourceType: "SESSION_RECORD", sourceId: "s2", observedAt: "2026-09-17T09:00:00Z", snapshot: { attendanceStatus: "ABSENT", windowSize: 5 } },
        { id: "e3", sourceType: "SESSION_RECORD", sourceId: "s3", observedAt: "2026-09-21T09:00:00Z", snapshot: { attendanceStatus: "ABSENT", windowSize: 5 } },
      ],
    });
    expect(attentionCardSubtitle(r)).toBe("3 من آخر 5 حصص");
  });

  it("attentionCardSubtitle returns undefined when the primary reason has no concrete count (dashboard card falls back to the main line alone)", () => {
    const r = reason({ ruleKey: "absence.frequency", evidence: [] });
    expect(attentionCardSubtitle(r)).toBeUndefined();
  });
});
