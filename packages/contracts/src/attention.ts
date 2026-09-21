import { z } from "zod";
import { cursorPageSchema } from "./pagination";

/**
 * Attention / Follow-up contract types — Phase 7, API Contract v1.0 §9.7,
 * §11.13-11.14. Shared between apps/api (producer) and apps/web (consumer).
 *
 * `priority` on every case DTO is ALWAYS the caller's own VISIBLE priority
 * (computed server-side from only the Reasons the caller has Group Scope
 * over — see `computeVisiblePriority`, packages/database) — never the
 * Case's full/internal value. A SELECTED_GROUPS caller must never be able
 * to infer, even indirectly through a higher priority number, that a
 * problem exists in a group they cannot see.
 */

export const attentionCaseStatusSchema = z.enum(["NEW", "IN_FOLLOWUP", "CONTACTED", "MONITORING", "CLOSED"]);
export type AttentionCaseStatus = z.infer<typeof attentionCaseStatusSchema>;

export const attentionSeveritySchema = z.enum(["MEDIUM", "HIGH"]);
export type AttentionSeverity = z.infer<typeof attentionSeveritySchema>;

export const attentionEvidenceSchema = z.object({
  id: z.string().uuid(),
  sourceType: z.enum(["SESSION_RECORD", "SESSION"]),
  sourceId: z.string().uuid(),
  observedAt: z.string(),
  snapshot: z.record(z.unknown()),
});
export type AttentionEvidenceDto = z.infer<typeof attentionEvidenceSchema>;

export const attentionReasonSchema = z.object({
  id: z.string().uuid(),
  ruleKey: z.string(),
  severity: attentionSeveritySchema,
  groupId: z.string().uuid(),
  firstDetectedAt: z.string(),
  lastDetectedAt: z.string(),
  evidence: z.array(attentionEvidenceSchema),
});
export type AttentionReasonDto = z.infer<typeof attentionReasonSchema>;

/**
 * Human-readable Arabic label for an attention rule key — the SINGLE source of
 * truth shared by the web (case detail list) and the server (dashboard / action
 * center item titles), so every surface explains WHY a case exists in the same
 * words.
 *
 * Rule keys are the DOT-CASED strings the rule engine actually emits at
 * `packages/database/src/attention/rule-engine.ts` (the `RuleKey` union at line
 * 18-24). The historical UPPER_SNAKE keys (`ATTENDANCE_ABSENCE_STREAK`, etc.)
 * were an initial naming that never reached production data — the engine has
 * always emitted the dotted keys — so they are kept ONLY as defensive aliases
 * pointing at the same labels, in case a downstream integration was ever
 * written against them. Removing them silently would also require confidence
 * they are unused; the alias keeps things loud and cheap.
 */
export const ATTENTION_RULE_LABEL: Record<string, string> = {
  // Engine-emitted keys (current production).
  "absence.consecutive": "غياب متتالٍ",
  "absence.frequency": "غياب متكرر",
  "homework.consecutive": "تقصير متتالٍ في الواجب",
  "homework.frequency": "تقصير متكرر في الواجب",
  "exam.low": "درجة امتحان منخفضة",
  "combined.medium": "تراكم إشارات متابعة",
  // Legacy UPPER_SNAKE aliases — kept as defensive fallbacks; not emitted by the current engine.
  ATTENDANCE_ABSENCE_STREAK: "غياب متكرر",
  HOMEWORK_NOT_DONE_STREAK: "تقصير متكرر في الواجب",
  LOW_EXAM_SCORE: "درجة امتحان منخفضة",
};

/**
 * Rule-key → label. Fallback is intentionally honest: "لم يُسجَّل سبب تفصيلي
 * لهذه الحالة بعد" — never a generic "حالة تحتاج متابعة" that misleads the
 * teacher into thinking the system has flagged a specific problem. When this
 * fallback fires it means the case exists but the rule engine wrote a
 * rule_key the client doesn't recognise (a data-generation bug or a legacy
 * row) — the UI is then expected to show the caller an action to add /
 * inspect the reason, never a fabricated cause.
 */
export function attentionRuleLabel(ruleKey: string | null | undefined): string {
  return (ruleKey && ATTENTION_RULE_LABEL[ruleKey]) || "لم يُسجَّل سبب تفصيلي لهذه الحالة بعد";
}

/**
 * Small helpers used by both the API (dashboard card subtitle + case list
 * summary) and the web case detail page to build a HUMAN sentence from a
 * reason + its attached evidence. Every field is derived from real
 * `attention_evidence.snapshot` data — nothing here fabricates a signal,
 * and the count comes from the evidence snapshot itself, never a generic
 * `array.length` interpretation.
 *
 * Snapshot shape (see `rule-engine.ts`):
 *   absence.*:  { attendanceStatus?, windowSize? }
 *   homework.*: { homeworkStatus?, windowSize? }
 *   exam.low:   { examScore?, threshold? }
 * The date pieces come from the reason itself, never from the raw snapshot
 * dump — we never leak JSON to the reader.
 */
function formatShortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "long" }).format(d);
}

/** Number of ABSENT evidence rows in this reason (from snapshot, not just length). */
function countAbsences(reason: AttentionReasonDto): number {
  return reason.evidence.filter((e) => (e.snapshot as { attendanceStatus?: string })?.attendanceStatus === "ABSENT").length;
}

/** Number of NOT_DONE / PARTIAL homework rows. */
function countHomeworkGaps(reason: AttentionReasonDto): number {
  return reason.evidence.filter((e) => {
    const s = (e.snapshot as { homeworkStatus?: string })?.homeworkStatus;
    return s === "NOT_DONE" || s === "PARTIAL";
  }).length;
}

/** Window size the rule was evaluated over — pulled off the FIRST evidence's snapshot; the rule engine writes the same windowSize on every evidence in the reason. */
function windowSize(reason: AttentionReasonDto): number | undefined {
  const first = reason.evidence[0]?.snapshot as { windowSize?: number } | undefined;
  return typeof first?.windowSize === "number" ? first.windowSize : undefined;
}

function safeExamScore(reason: AttentionReasonDto): number | undefined {
  const last = reason.evidence[reason.evidence.length - 1]?.snapshot as { examScore?: number } | undefined;
  return typeof last?.examScore === "number" ? last.examScore : undefined;
}

/**
 * Build a single-sentence Arabic summary of ONE reason. Uses the reason's
 * own `lastDetectedAt` for the "بتاريخ …" hint (never the current time) —
 * so the copy stays truthful even for a case that hasn't re-qualified in a
 * while.
 *
 * Never renders raw JSON, never invents a count, never claims a signal the
 * rule engine did not detect. When the reason's evidence is empty (which
 * can happen for a legacy row before the rule engine started attaching
 * evidence) the summary falls back to the plain rule label alone.
 */
export function attentionReasonSummary(reason: AttentionReasonDto): string {
  const label = attentionRuleLabel(reason.ruleKey);
  const dateHint = formatShortDate(reason.lastDetectedAt);
  const detail = describeReasonDetail(reason);
  const parts = [label, detail].filter((s): s is string => !!s);
  const line = parts.join(" — ");
  return dateHint ? `${line} · آخر رصد ${dateHint}` : line;
}

function describeReasonDetail(reason: AttentionReasonDto): string | null {
  const win = windowSize(reason);
  switch (reason.ruleKey) {
    case "absence.consecutive": {
      const n = countAbsences(reason);
      if (n < 2) return null;
      return `${n} حصص متتالية بغياب`;
    }
    case "absence.frequency": {
      const n = countAbsences(reason);
      if (n === 0 || !win) return null;
      return `${n} من آخر ${win} حصص`;
    }
    case "homework.consecutive": {
      const n = countHomeworkGaps(reason);
      if (n < 2) return null;
      return `${n} حصص متتالية بلا واجب مكتمل`;
    }
    case "homework.frequency": {
      const n = countHomeworkGaps(reason);
      if (n === 0 || !win) return null;
      return `${n} من آخر ${win} حصص`;
    }
    case "exam.low": {
      const score = safeExamScore(reason);
      return typeof score === "number" ? `آخر درجة ${score}` : null;
    }
    case "combined.medium":
      return "عدة إشارات في الحضور والواجب معًا";
    default:
      return null;
  }
}

/**
 * SHORT subtitle for the dashboard card / action-center row — the summary
 * for the case's primary (highest-severity, first-listed) reason ONLY, with
 * NO date suffix (the dashboard cell is already tight; the full summary
 * lives on the case detail page).
 */
export function attentionCardSubtitle(reason: AttentionReasonDto): string | undefined {
  const detail = describeReasonDetail(reason);
  return detail ?? undefined;
}

/** List-row shape (API §9.7 `GET /attention-cases` — "Unified active/history cases"; field set derived from PRD §13's Queue row: student/reasons/next action/last contact). */
export const attentionCaseSummarySchema = z.object({
  id: z.string().uuid(),
  studentId: z.string().uuid(),
  // Phase 11 — batched (no N+1), so the queue is directly usable without a
  // per-row student fetch from the frontend.
  studentName: z.string(),
  studentCode: z.string(),
  status: attentionCaseStatusSchema,
  priority: attentionSeveritySchema,
  openedAt: z.string(),
  lastQualifiedAt: z.string(),
});
export type AttentionCaseSummary = z.infer<typeof attentionCaseSummarySchema>;

export const listAttentionCasesResponseSchema = cursorPageSchema(attentionCaseSummarySchema);
export type ListAttentionCasesResponse = z.infer<typeof listAttentionCasesResponseSchema>;

/** §11.13 detail response — `reasons`/`evidence` are the caller's VISIBLE subset only. */
export const attentionCaseSchema = z.object({
  id: z.string().uuid(),
  student: z.object({ id: z.string().uuid(), name: z.string(), studentCode: z.string() }),
  status: attentionCaseStatusSchema,
  priority: attentionSeveritySchema,
  openedAt: z.string(),
  lastQualifiedAt: z.string(),
  reasons: z.array(attentionReasonSchema),
  lastContact: z
    .object({ id: z.string().uuid(), channel: z.string(), outcome: z.string(), createdAt: z.string() })
    .nullable(),
  nextFollowUp: z.object({ id: z.string().uuid(), dueAt: z.string(), status: z.string() }).nullable(),
  version: z.number().int(),
});
export type AttentionCase = z.infer<typeof attentionCaseSchema>;

export const attentionCaseTransitionResponseSchema = z.object({ case: attentionCaseSchema });
export type AttentionCaseTransitionResponse = z.infer<typeof attentionCaseTransitionResponseSchema>;

// ---------------------------------------------------------------------------
// WhatsApp Contact Draft / Outcome — §11.14
// ---------------------------------------------------------------------------

export const contactDraftRequestSchema = z.object({
  guardianId: z.string().uuid(),
  sessionId: z.string().uuid().optional(),
});
export type ContactDraftRequest = z.infer<typeof contactDraftRequestSchema>;

export const contactDraftResponseSchema = z.object({
  channel: z.literal("WHATSAPP_DEEPLINK"),
  guardian: z.object({ id: z.string().uuid(), maskedPhone: z.string() }),
  draft: z.string(),
  /** `wa.me/<E164 without leading '+'>?text=<urlencoded draft>` — no concrete format is given in the approved API doc (§11.14 literally leaves this as "generated-at-client-or-safe-server-value"); this is the deliberate, documented technical choice made for this phase. */
  deepLink: z.string(),
});
export type ContactDraftResponse = z.infer<typeof contactDraftResponseSchema>;

export const contactChannelSchema = z.enum(["WHATSAPP_DEEPLINK", "CALL", "OTHER"]);
export type ContactChannel = z.infer<typeof contactChannelSchema>;

export const contactOutcomeSchema = z.enum(["CONTACTED", "NO_ANSWER", "INVALID_NUMBER", "DEFERRED"]);
export type ContactOutcome = z.infer<typeof contactOutcomeSchema>;

export const createContactLogRequestSchema = z
  .object({
    studentId: z.string().uuid(),
    guardianId: z.string().uuid(),
    attentionCaseId: z.string().uuid().nullable().optional(),
    sessionId: z.string().uuid().nullable().optional(),
    channel: contactChannelSchema,
    draftSnapshot: z.string(),
    outcome: contactOutcomeSchema,
    notes: z.string().nullable().optional(),
    /** Required exactly when outcome=DEFERRED (§9.4). */
    followUpAt: z.string().nullable().optional(),
  })
  .refine((body) => (body.outcome === "DEFERRED" ? !!body.followUpAt : true), {
    message: "followUpAt مطلوب عند outcome=DEFERRED.",
    path: ["followUpAt"],
  });
export type CreateContactLogRequest = z.infer<typeof createContactLogRequestSchema>;

export const contactLogSchema = z.object({
  id: z.string().uuid(),
  studentId: z.string().uuid(),
  guardianId: z.string().uuid(),
  attentionCaseId: z.string().uuid().nullable(),
  sessionId: z.string().uuid().nullable(),
  channel: contactChannelSchema,
  draftSnapshot: z.string(),
  outcome: contactOutcomeSchema,
  notes: z.string().nullable(),
  followUpAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ContactLog = z.infer<typeof contactLogSchema>;

export const createContactLogResponseSchema = z.object({
  contactLog: contactLogSchema,
  scheduledFollowUp: z.object({ id: z.string().uuid(), dueAt: z.string(), status: z.string() }).nullable(),
});
export type CreateContactLogResponse = z.infer<typeof createContactLogResponseSchema>;

// ---------------------------------------------------------------------------
// Scheduled Follow-ups — §9.7 `GET /followups`, complete/reschedule
// ---------------------------------------------------------------------------

export const scheduledFollowupStatusSchema = z.enum(["PENDING", "DONE", "CANCELLED"]);
export type ScheduledFollowupStatus = z.infer<typeof scheduledFollowupStatusSchema>;

export const scheduledFollowupSchema = z.object({
  id: z.string().uuid(),
  attentionCaseId: z.string().uuid(),
  studentId: z.string().uuid(),
  dueAt: z.string(),
  status: scheduledFollowupStatusSchema,
  completedAt: z.string().nullable(),
  version: z.number().int(),
});
export type ScheduledFollowup = z.infer<typeof scheduledFollowupSchema>;

export const listFollowupsResponseSchema = cursorPageSchema(scheduledFollowupSchema);
export type ListFollowupsResponse = z.infer<typeof listFollowupsResponseSchema>;

export const rescheduleFollowupRequestSchema = z.object({
  version: z.number().int(),
  dueAt: z.string(),
});
export type RescheduleFollowupRequest = z.infer<typeof rescheduleFollowupRequestSchema>;

export const completeFollowupRequestSchema = z.object({ version: z.number().int() });
export type CompleteFollowupRequest = z.infer<typeof completeFollowupRequestSchema>;

export const followupActionResponseSchema = z.object({ followUp: scheduledFollowupSchema });
export type FollowupActionResponse = z.infer<typeof followupActionResponseSchema>;

export const attentionCaseTransitionRequestSchema = z.object({ version: z.number().int() });
export type AttentionCaseTransitionRequest = z.infer<typeof attentionCaseTransitionRequestSchema>;
