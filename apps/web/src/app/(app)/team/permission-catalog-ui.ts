import type { PermissionKey } from "@academic-precision/contracts";

/**
 * UI presentation layer for the permission catalog — Arabic labels, visual
 * grouping, role presets, and the "risky" set. This is purely how the catalog
 * is DISPLAYED and pre-filled; the source of truth for keys/dependencies/scope
 * remains `@academic-precision/contracts` (permission-catalog.ts), and the
 * backend re-validates every grant regardless of what the UI sends.
 */

export interface PermissionMeta {
  key: PermissionKey;
  label: string;
  /** WORKSPACE-scoped permissions can't be narrowed to groups (matches PERMISSION_SCOPE_KIND). */
}

export interface PermissionCategory {
  key: string;
  label: string;
  permissions: { key: PermissionKey; label: string }[];
}

/** Grouped, ordered for the editor. Every catalog key appears exactly once. */
export const PERMISSION_CATEGORIES: PermissionCategory[] = [
  {
    key: "students",
    label: "الطلاب",
    permissions: [
      { key: "students.view_basic", label: "عرض الطلاب" },
      { key: "students.edit", label: "تعديل بيانات الطالب" },
      { key: "parent_contact", label: "عرض بيانات التواصل" },
    ],
  },
  {
    key: "groups",
    label: "المجموعات",
    permissions: [
      { key: "groups.view", label: "عرض المجموعات" },
      { key: "groups.manage", label: "إدارة المجموعات" },
    ],
  },
  {
    key: "sessions",
    label: "الحصص والحضور",
    permissions: [
      { key: "sessions.manage", label: "إدارة الحصص" },
      { key: "attendance.read", label: "عرض الحضور" },
      { key: "attendance.write", label: "تسجيل الحضور" },
    ],
  },
  {
    key: "homework",
    label: "الواجبات",
    permissions: [
      { key: "homework.read", label: "عرض الواجبات" },
      { key: "homework.write", label: "تسجيل الواجبات" },
    ],
  },
  {
    key: "exams",
    label: "الاختبارات",
    permissions: [
      { key: "exams.read", label: "عرض الاختبارات" },
      { key: "exams.write", label: "تسجيل نتائج الاختبارات" },
    ],
  },
  {
    key: "followup",
    label: "المتابعة",
    permissions: [
      { key: "followup.read", label: "عرض المتابعات" },
      { key: "followup.write", label: "تنفيذ المتابعة" },
    ],
  },
  {
    key: "finance",
    label: "المالية",
    permissions: [
      { key: "payments.view_student_status", label: "عرض حالة الدفع" },
      { key: "payments.record", label: "تسجيل دفعة" },
      { key: "finance.overview", label: "النظرة المالية العامة" },
    ],
  },
  {
    key: "reports",
    label: "التقارير",
    permissions: [
      { key: "reports.view", label: "عرض التقارير" },
      { key: "reports.export", label: "تصدير التقارير" },
    ],
  },
  {
    key: "team",
    label: "الفريق",
    permissions: [{ key: "team.manage", label: "إدارة الفريق" }],
  },
];

export const PERMISSION_LABEL: Record<PermissionKey, string> = Object.fromEntries(
  PERMISSION_CATEGORIES.flatMap((c) => c.permissions.map((p) => [p.key, p.label])),
) as Record<PermissionKey, string>;

/** Permissions that grant broad/administrative reach — trigger a calm warning when enabled. */
export const RISKY_PERMISSIONS: ReadonlySet<PermissionKey> = new Set<PermissionKey>([
  "team.manage",
  "finance.overview",
  "payments.record",
  "groups.manage",
]);

export interface RolePreset {
  key: string;
  label: string;
  description: string;
  /** Permission set the preset grants (dependencies are auto-included on apply). */
  permissions: PermissionKey[];
}

/**
 * Role presets — a starting point the owner can customize. `finance`-touching
 * keys are excluded from Operations Manager by product decision (least
 * privilege; finance must be granted explicitly). `team.manage` is never in a
 * preset (owner-only).
 */
export const ROLE_PRESETS: RolePreset[] = [
  {
    key: "operations",
    label: "مدير تشغيل",
    description: "يدير التشغيل اليومي بالكامل — بلا صلاحيات مالية.",
    permissions: [
      "students.view_basic",
      "students.edit",
      "parent_contact",
      "groups.view",
      "groups.manage",
      "sessions.manage",
      "attendance.read",
      "attendance.write",
      "homework.read",
      "homework.write",
      "exams.read",
      "exams.write",
      "followup.read",
      "followup.write",
      "reports.view",
      "reports.export",
    ],
  },
  {
    key: "assistant",
    label: "مساعد مدرس",
    description: "يسجّل الحضور والواجبات والنتائج داخل مجموعاته.",
    permissions: [
      "students.view_basic",
      "groups.view",
      "attendance.read",
      "attendance.write",
      "homework.read",
      "homework.write",
      "exams.read",
      "exams.write",
      "followup.read",
    ],
  },
  {
    key: "followup",
    label: "مساعد متابعة",
    description: "يتابع الحالات ويسجّل نتيجة التواصل مع أولياء الأمور.",
    permissions: ["students.view_basic", "parent_contact", "followup.read", "followup.write", "reports.view"],
  },
  {
    key: "finance",
    label: "محاسب",
    description: "يدير المستحقات والمدفوعات والتقارير المالية.",
    permissions: [
      "students.view_basic",
      "payments.view_student_status",
      "payments.record",
      "finance.overview",
      "reports.view",
    ],
  },
  {
    key: "custom",
    label: "صلاحيات مخصّصة",
    description: "ابدأ من الصفر وحدّد كل صلاحية بنفسك.",
    permissions: [],
  },
];
