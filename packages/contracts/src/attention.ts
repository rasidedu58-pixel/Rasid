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
 * words. Keep in sync with the rule engine's emitted `ruleKey`s
 * (packages/database/src/attention/rule-engine).
 */
export const ATTENTION_RULE_LABEL: Record<string, string> = {
  ATTENDANCE_ABSENCE_STREAK: "غياب متكرر",
  HOMEWORK_NOT_DONE_STREAK: "تقصير متكرر في الواجب",
  LOW_EXAM_SCORE: "درجة امتحان منخفضة",
};

/** Rule-key → label, with a safe generic fallback for any future/unknown rule. */
export function attentionRuleLabel(ruleKey: string | null | undefined): string {
  return (ruleKey && ATTENTION_RULE_LABEL[ruleKey]) || "حالة تحتاج متابعة";
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
