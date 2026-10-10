/**
 * One vocabulary for a GroupMonth's commercial settings, shared by every
 * screen that shows or edits them (create-group wizard, prepare-month,
 * the monthly-config dialog, the GroupMonth page).
 *
 * Why it exists: the same three fields were labelled differently on each
 * screen — «يوم الاستحقاق», «سياسة الاستحقاق», «رسوم الانضمام أثناء الشهر» —
 * all accounting terms a teacher does not use. The stored domain values
 * (UNIFIED / PER_GROUP / OVERRIDE, ASK_EVERY_TIME / FULL / REMAINING) are
 * untouched; only the words the user reads live here.
 *
 * `DUE_DAY_RANGE_HINT` states the real reason the range is 1–28: it is the
 * `group_months_due_day_check` CHECK constraint (Database Schema §5.4), and
 * the constraint exists so the chosen day exists in EVERY month — February
 * included. `computeObligationDueDate` does clamp a longer month down, but
 * that would silently mean "the 29th" = "the 28th" in February, so the
 * range stays 1–28 rather than inventing an end-of-month policy that the
 * domain has not decided.
 */

export const DUE_DAY_LABEL = "يوم تحصيل الرسوم كل شهر";
export const DUE_DAY_RANGE_HINT = "من 1 إلى 28 لضمان وجود اليوم في جميع الشهور";
export const DUE_DAY_EXPLAINER = "إذا اخترت 5، تصبح رسوم الطالب مستحقة يوم 5 من كل شهر.";

export const DUE_POLICY_LABEL = "من يحدد يوم التحصيل";
export const DUE_POLICY_OPTIONS = [
  { value: "UNIFIED", label: "يوم موحّد لكل المساحة" },
  { value: "PER_GROUP", label: "يوم خاص بهذه المجموعة" },
  { value: "OVERRIDE", label: "استثناء لهذا الشهر فقط" },
] as const;

export const JOIN_FEE_POLICY_LABEL = "لو انضم طالب بعد بداية الشهر";
export const JOIN_FEE_POLICY_OPTIONS = [
  { value: "FULL", label: "يدفع الرسوم كاملة" },
  { value: "REMAINING", label: "يدفع حسب الحصص المتبقية فقط" },
  { value: "ASK_EVERY_TIME", label: "اسألني في كل مرة" },
] as const;

export const MONTHLY_FEE_LABEL = "الرسوم الشهرية (جنيه)";

/**
 * The honest scope statement for editing a month's fee / collection day.
 * It is exactly what the code does: `applyGroupMonthChange` only writes the
 * `group_months` row and never recalculates an existing
 * `financial_obligations` row, and the next month inherits whatever this
 * month ends up holding (carry-forward copies fee / collection day /
 * join policy / schedule from the source month's GroupMonth).
 */
export const MONTH_CONFIG_SCOPE_NOTE =
  "التعديل يسري على هذا الشهر. التزامات الطلاب المسجّلة بالفعل لا تتغير، والمبلغ الجديد يُطبَّق على من يُسجَّل بعد الآن — والشهر القادم يرث هذا الإعداد عند تجهيزه.";

/** Read-only value labels (GroupMonth page «الإعداد الشهري» stats). */
export const DUE_POLICY_VALUE_LABEL: Record<string, string> = Object.fromEntries(
  DUE_POLICY_OPTIONS.map((o) => [o.value, o.label]),
);
export const JOIN_FEE_POLICY_VALUE_LABEL: Record<string, string> = Object.fromEntries(
  JOIN_FEE_POLICY_OPTIONS.map((o) => [o.value, o.label]),
);

/** Arabic field names for the monthly-config change preview diff. */
export const GROUP_MONTH_FIELD_LABEL: Record<string, string> = {
  locationId: "المكان",
  baseFeeMinor: "الرسوم الشهرية",
  duePolicy: DUE_POLICY_LABEL,
  dueDay: DUE_DAY_LABEL,
  joinFeePolicy: JOIN_FEE_POLICY_LABEL,
};

/** Human value for one diff row — money in pounds, policies by label, null as «غير محدد». */
export function formatGroupMonthFieldValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "غير محدد";
  if (field === "baseFeeMinor") return `${new Intl.NumberFormat("ar-EG").format(Number(value) / 100)} جنيه`;
  if (field === "duePolicy") return DUE_POLICY_VALUE_LABEL[String(value)] ?? String(value);
  if (field === "joinFeePolicy") return JOIN_FEE_POLICY_VALUE_LABEL[String(value)] ?? String(value);
  if (field === "dueDay") return `يوم ${new Intl.NumberFormat("ar-EG").format(Number(value))}`;
  return String(value);
}
