import type { OnboardingStepKey } from "@academic-precision/contracts";

/**
 * Per-step presentation metadata for the guided-setup launcher/panel and
 * the compact dashboard summary. Kept in ONE place so the copy stays
 * consistent between the FAB, the sheet, and the dashboard card.
 *
 * The wording deliberately matches the underlying business action:
 *   • The CTA verb is the action the API mutation performs (create the
 *     current month, create a group + its schedule, enrol students,
 *     record attendance).
 *   • The description explains the outcome, not the mechanism.
 *   • The `depHint` explains the reason a LOCKED step is locked, in one
 *     short sentence, so the user is never confronted with a greyed
 *     row that gives no rationale.
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
  operatingMonth: {
    key: "operatingMonth",
    title: "جهّز شهرك التشغيلي",
    description: "حدّد فترة العمل وإعدادات الشهر لتبدأ مجموعاتك على أساس واضح.",
    cta: "تجهيز الشهر",
    href: "/months/new",
    depHint: "ابدأ من الشهر لتربط به مجموعاتك.",
  },
  groupSetup: {
    key: "groupSetup",
    title: "أنشئ أول مجموعة",
    description: "أضف مجموعتك وحدّد مواعيدها الأسبوعية ليبني راصد الجدول تلقائيًا.",
    cta: "إنشاء مجموعة",
    href: "/groups",
    depHint: "أكمل تجهيز الشهر أولًا.",
  },
  students: {
    key: "students",
    title: "أضف طلابك",
    description: "أضف طلابك واربطهم بالمجموعة لتصبح جاهزة للتشغيل.",
    cta: "إضافة الطلاب",
    href: "/students",
    depHint: "أنشئ المجموعة أولًا لتضم إليها طلابك.",
  },
  sessions: {
    key: "sessions",
    title: "حصصك أصبحت جاهزة",
    description: "يجهّز راصد حصصك تلقائيًا من مواعيد المجموعة — راجع القائمة.",
    cta: "عرض الحصص",
    href: "/sessions",
    depHint: "بعد إعداد المجموعة والطلاب ستظهر الحصص تلقائيًا.",
    completedDescription: "أنشأ راصد حصصك تلقائيًا حسب مواعيد المجموعة.",
  },
  attendance: {
    key: "attendance",
    title: "سجّل حضور أول حصة",
    description: "افتح إحدى حصصك وسجّل الحضور لتبدأ استخدام راصد فعليًا.",
    cta: "تسجيل الحضور",
    href: "/sessions",
    depHint: "لا توجد حصص بعد لتسجيل حضورها.",
  },
};

/**
 * Fixed rendering order — mirrors `ONBOARDING_STEP_ORDER` in
 * `@academic-precision/contracts`. Kept as a separate list here so any
 * consumer that also needs the ordered meta can iterate without a second
 * lookup.
 */
export const ONBOARDING_STEP_META_ORDERED: readonly OnboardingStepMeta[] = [
  ONBOARDING_STEP_META.operatingMonth,
  ONBOARDING_STEP_META.groupSetup,
  ONBOARDING_STEP_META.students,
  ONBOARDING_STEP_META.sessions,
  ONBOARDING_STEP_META.attendance,
] as const;
