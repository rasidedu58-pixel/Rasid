/** Shared Arabic labels + tones for platform-console subscription/account states. */
export const SUB_STATE_LABEL: Record<string, string> = {
  TRIAL: "تجربة",
  ACTIVE: "نشط",
  EXPIRING: "قارب على الانتهاء",
  EXPIRED: "منتهٍ",
  PAYMENT_FAILED: "فشل الدفع",
  CANCELLED_AT_PERIOD_END: "سيُلغى نهاية الفترة",
};

export function subStateTone(state: string | null | undefined): "success" | "warning" | "danger" | "neutral" {
  switch (state) {
    case "ACTIVE":
      return "success";
    case "TRIAL":
    case "EXPIRING":
    case "CANCELLED_AT_PERIOD_END":
      return "warning";
    case "EXPIRED":
    case "PAYMENT_FAILED":
      return "danger";
    default:
      return "neutral";
  }
}

export const ACCOUNT_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "نشط",
  DISABLED: "معطّل",
};

export const MEMBER_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "نشط",
  INVITED: "مدعو",
  DISABLED: "معطّل",
};

export const CAPABILITY_LABEL: Record<string, string> = {
  CORE_OPERATIONS: "التشغيل الأساسي",
  CREATE_MONTH: "إنشاء شهر",
  TEAM_MANAGEMENT: "إدارة الفريق",
  REPORT_EXPORT: "تصدير التقارير",
};

const AR_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
export function monthLabel(year: number, month: number): string {
  return `${AR_MONTHS[month - 1] ?? month} ${year}`;
}

// --- Platform Operations (Unit 1) -------------------------------------------
export const PLATFORM_CONTACT_CHANNEL_LABEL: Record<string, string> = {
  CALL: "اتصال",
  WHATSAPP: "واتساب",
  EMAIL: "بريد إلكتروني",
  SMS: "رسالة نصية",
  IN_PERSON: "حضوري",
  OTHER: "أخرى",
};

export const PLATFORM_CONTACT_DIRECTION_LABEL: Record<string, string> = {
  OUTBOUND: "صادر",
  INBOUND: "وارد",
};

export const FOLLOW_UP_STATUS_LABEL: Record<string, string> = {
  PENDING: "قيد المتابعة",
  DONE: "تمّت",
  CANCELLED: "أُلغيت",
};

export function followUpStatusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  switch (status) {
    case "DONE":
      return "success";
    case "PENDING":
      return "warning";
    case "CANCELLED":
      return "neutral";
    default:
      return "neutral";
  }
}

export const PLATFORM_ROLE_LABEL: Record<string, string> = {
  PLATFORM_OWNER: "مالك المنصة",
  OPERATIONS_ADMIN: "مدير عمليات",
  SUPPORT_AGENT: "وكيل دعم",
};

// --- Platform Issues Center -------------------------------------------------
export const SERVICE_STATUS_LABEL: Record<string, string> = {
  OPERATIONAL: "تعمل بصورة طبيعية",
  DEGRADED: "أداء متدهور",
  DOWN: "متوقفة",
  UNKNOWN: "غير معروفة",
};

export function serviceStatusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  switch (status) {
    case "OPERATIONAL":
      return "success";
    case "DEGRADED":
      return "warning";
    case "DOWN":
      return "danger";
    default:
      return "neutral";
  }
}

export const PLATFORM_SERVICE_LABEL: Record<string, string> = {
  web: "الواجهة (Web)",
  api: "واجهة البرمجة (API)",
  database: "قاعدة البيانات",
  worker: "المعالج الخلفي (Worker)",
};

export const ISSUE_SEVERITY_LABEL: Record<string, string> = {
  INFO: "معلومة",
  WARNING: "تحذير",
  CRITICAL: "حرِج",
};

export function issueSeverityTone(sev: string): "success" | "warning" | "danger" | "neutral" {
  switch (sev) {
    case "CRITICAL":
      return "danger";
    case "WARNING":
      return "warning";
    default:
      return "neutral";
  }
}

// --- Operating-Month Overrides ----------------------------------------------
export const MONTH_OVERRIDE_TYPE_LABEL: Record<string, string> = {
  EARLY_PREP_ALLOWED: "سماح بالتحضير المبكر",
  PREP_BLOCKED: "منع تحضير الأشهر",
};

export function monthOverrideTone(type: string): "success" | "warning" | "danger" | "neutral" {
  return type === "PREP_BLOCKED" ? "danger" : "warning";
}
