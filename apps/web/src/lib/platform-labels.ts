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
