import type { OnboardingStepKey } from "@academic-precision/contracts";

/**
 * Per-step presentation metadata for the guided-setup launcher/panel and
 * the compact dashboard summary. Kept in ONE place so the copy stays
 * consistent between the FAB, the sheet, and the dashboard card.
 *
 * The wording is intentionally teacher-natural — no `group_month`,
 * `schedule_rules`, `enrollment entity`, or `GENERATED origin` leaks
 * into the visible strings.
 */
export interface OnboardingStepMeta {
  key: OnboardingStepKey;
  title: string;
  description: string;
  cta: string;
  href: string;
  /** Short reason shown under a LOCKED step. */
  depHint: string;
  /** Optional description shown only after this step is COMPLETED. */
  completedDescription?: string;
}

export const ONBOARDING_STEP_META: Record<OnboardingStepKey, OnboardingStepMeta> = {
  createGroup: {
    key: "createGroup",
    title: "أنشئ أول مجموعة",
    description:
      "ابدأ بمجموعتك التي تدرّس لها، ومنها سيهيّئ راصد شهر التشغيل ومواعيد الحصص.",
    cta: "إنشاء مجموعة",
    href: "/groups",
    // createGroup is the first step, so it's never rendered as LOCKED —
    // this hint is a defensive fallback the UI will never actually show.
    depHint: "",
    completedDescription: "مجموعتك جاهزة.",
  },
  prepareMonth: {
    key: "prepareMonth",
    title: "جهّز شهر التشغيل",
    description:
      "حدّد الشهر ومواعيد المجموعة الأسبوعية ورسومها — سيهيّئ راصد حصص هذا الشهر تلقائيًا.",
    cta: "تجهيز الشهر",
    href: "/months/new",
    depHint: "أنشئ أول مجموعة أولًا.",
    completedDescription: "تم تجهيز الشهر ومواعيد المجموعة.",
  },
  enrollStudents: {
    key: "enrollStudents",
    title: "أضف طلابك للمجموعة",
    description: "سجّل أول طلابك في المجموعة لتصبح جاهزة للتشغيل.",
    cta: "إضافة الطلاب",
    href: "/students",
    depHint: "جهّز مجموعتك في شهر التشغيل أولًا لتضمّ إليها الطلاب.",
  },
  recordAttendance: {
    key: "recordAttendance",
    title: "سجّل حضور أول حصة",
    description: "افتح إحدى حصصك وسجّل الحضور لتبدأ استخدام راصد فعليًا.",
    cta: "تسجيل الحضور",
    href: "/sessions",
    depHint: "أضف الطلاب أولًا لتظهر قائمة الحضور.",
    completedDescription: "سجّلت أول حضور بنجاح.",
  },
};

/**
 * Fixed rendering order — mirrors `ONBOARDING_STEP_ORDER` in
 * `@academic-precision/contracts`. Kept as a separate list here so any
 * consumer that also needs the ordered meta can iterate without a second
 * lookup.
 */
export const ONBOARDING_STEP_META_ORDERED: readonly OnboardingStepMeta[] = [
  ONBOARDING_STEP_META.createGroup,
  ONBOARDING_STEP_META.prepareMonth,
  ONBOARDING_STEP_META.enrollStudents,
  ONBOARDING_STEP_META.recordAttendance,
] as const;

/**
 * Confidence copy shown under the `prepareMonth` step when the raw
 * `sessionsGenerated` signal is on. NOT a task; NOT a step; NOT a CTA.
 * The client renders this as a subtle line to reinforce that the
 * auto-generation ran — the reason there's no separate "sessions" step.
 */
export const SESSIONS_READY_CONFIDENCE_COPY =
  "تم تجهيز حصص هذا الشهر تلقائيًا حسب مواعيد المجموعة.";
