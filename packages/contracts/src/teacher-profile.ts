import { z } from "zod";

/**
 * Teacher profile foundation — the personal data collected in a light Step-2
 * onboarding ("عرّفنا بك في دقيقة") and editable later in settings. Shared by
 * apps/api (authoritative validation) and apps/web (form + hints). Types +
 * pure helpers only; the DB write / RLS enforcement lives server-side.
 *
 * V1 = Egypt: phone normalized to E.164 (+20…), governorate + subject from
 * fixed code lists (stable codes stored; Arabic labels shown in the UI).
 */

// --- Governorates (Egypt) ---------------------------------------------------
// Stable code -> Arabic label. The code is what's stored; the label is display.
export const EGYPT_GOVERNORATES = [
  { code: "CAIRO", ar: "القاهرة" },
  { code: "GIZA", ar: "الجيزة" },
  { code: "ALEXANDRIA", ar: "الإسكندرية" },
  { code: "DAKAHLIA", ar: "الدقهلية" },
  { code: "SHARQIA", ar: "الشرقية" },
  { code: "QALYUBIA", ar: "القليوبية" },
  { code: "GHARBIA", ar: "الغربية" },
  { code: "MENOFIA", ar: "المنوفية" },
  { code: "BEHEIRA", ar: "البحيرة" },
  { code: "KAFR_EL_SHEIKH", ar: "كفر الشيخ" },
  { code: "DAMIETTA", ar: "دمياط" },
  { code: "PORT_SAID", ar: "بورسعيد" },
  { code: "ISMAILIA", ar: "الإسماعيلية" },
  { code: "SUEZ", ar: "السويس" },
  { code: "FAYOUM", ar: "الفيوم" },
  { code: "BENI_SUEF", ar: "بني سويف" },
  { code: "MINYA", ar: "المنيا" },
  { code: "ASSIUT", ar: "أسيوط" },
  { code: "SOHAG", ar: "سوهاج" },
  { code: "QENA", ar: "قنا" },
  { code: "LUXOR", ar: "الأقصر" },
  { code: "ASWAN", ar: "أسوان" },
  { code: "RED_SEA", ar: "البحر الأحمر" },
  { code: "NEW_VALLEY", ar: "الوادي الجديد" },
  { code: "MATROUH", ar: "مطروح" },
  { code: "NORTH_SINAI", ar: "شمال سيناء" },
  { code: "SOUTH_SINAI", ar: "جنوب سيناء" },
] as const;

export const GOVERNORATE_CODES = EGYPT_GOVERNORATES.map((g) => g.code) as [string, ...string[]];
export const governorateSchema = z.enum(GOVERNORATE_CODES);
export type GovernorateCode = (typeof EGYPT_GOVERNORATES)[number]["code"];
export const GOVERNORATE_LABEL: Record<string, string> = Object.fromEntries(EGYPT_GOVERNORATES.map((g) => [g.code, g.ar]));

// --- Subjects ---------------------------------------------------------------
export const TEACHING_SUBJECTS = [
  { code: "ARABIC", ar: "اللغة العربية" },
  { code: "ENGLISH", ar: "اللغة الإنجليزية" },
  { code: "MATH", ar: "الرياضيات" },
  { code: "PHYSICS", ar: "الفيزياء" },
  { code: "CHEMISTRY", ar: "الكيمياء" },
  { code: "BIOLOGY", ar: "الأحياء" },
  { code: "SOCIAL_STUDIES", ar: "الدراسات الاجتماعية" },
  { code: "QURAN", ar: "القرآن الكريم" },
  { code: "ISLAMIC_STUDIES", ar: "الدراسات الإسلامية" },
  { code: "OTHER", ar: "أخرى" },
] as const;

export const SUBJECT_CODES = TEACHING_SUBJECTS.map((s) => s.code) as [string, ...string[]];
export const subjectSchema = z.enum(SUBJECT_CODES);
export type SubjectCode = (typeof TEACHING_SUBJECTS)[number]["code"];
export const SUBJECT_LABEL: Record<string, string> = Object.fromEntries(TEACHING_SUBJECTS.map((s) => [s.code, s.ar]));

// --- Egyptian phone normalization ------------------------------------------
/**
 * Normalizes an Egyptian mobile number to E.164 (+20XXXXXXXXXX). Accepts the
 * common local/international forms (01XXXXXXXXX, +201…, 00201…, 201…, with
 * spaces/dashes). Returns null when it is not a valid Egyptian mobile number.
 * Egyptian mobiles are 11 national digits: 01[0125] + 8 digits.
 */
export function normalizeEgyptianPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/[\s\-()]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("20")) d = d.slice(2); // country code
  else if (d.startsWith("0")) d = d.slice(1); // national trunk 0
  // Now expect 10 digits: 1[0125] + 8 digits.
  if (!/^1[0125]\d{8}$/.test(d)) return null;
  return `+20${d}`;
}

export const egyptianPhoneSchema = z
  .string()
  .trim()
  .min(1, "رقم الهاتف مطلوب")
  .refine((v) => normalizeEgyptianPhone(v) !== null, "رقم هاتف مصري غير صالح (مثال: 010xxxxxxxx)");

// --- Profile shape (GET /me) ------------------------------------------------
export const teacherProfileSchema = z.object({
  phone: z.string().nullable(),
  governorate: z.string().nullable(),
  subject: z.string().nullable(),
  subjectOther: z.string().nullable(),
  /** Deterministic: all required fields present (phone + governorate + subject, plus subjectOther when subject=OTHER). */
  profileCompleted: z.boolean(),
});
export type TeacherProfile = z.infer<typeof teacherProfileSchema>;

/** Pure completeness rule — the single source of truth for "onboarded". */
export function isTeacherProfileComplete(p: { phone?: string | null; governorate?: string | null; subject?: string | null; subjectOther?: string | null }): boolean {
  if (!p.phone || !p.governorate || !p.subject) return false;
  if (p.subject === "OTHER" && (!p.subjectOther || p.subjectOther.trim().length === 0)) return false;
  return true;
}

/**
 * The single mandatory-onboarding routing rule (shared by AuthGuard +
 * verify-email). A teacher (workspace-owning) whose profile is incomplete is
 * routed to Step-2 onboarding — but a platform-staff user is NEVER forced into
 * teacher onboarding, even if they happen to own an auto-provisioned workspace.
 */
export function shouldForceTeacherOnboarding(s: {
  workspaceReady: boolean;
  isOwner: boolean;
  isPlatformStaff: boolean;
  profileCompleted: boolean;
}): boolean {
  return s.workspaceReady && s.isOwner && !s.isPlatformStaff && !s.profileCompleted;
}

const subjectOtherRefine = (v: { subject?: string; subjectOther?: string }, ctx: z.RefinementCtx) => {
  if (v.subject === "OTHER" && (!v.subjectOther || v.subjectOther.trim().length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["subjectOther"], message: "حدّد اسم المادة" });
  }
};

// --- Step-2 onboarding (all three required) ---------------------------------
export const completeTeacherOnboardingRequestSchema = z
  .object({
    phone: egyptianPhoneSchema,
    governorate: governorateSchema,
    subject: subjectSchema,
    subjectOther: z.string().trim().max(120).optional(),
  })
  .superRefine(subjectOtherRefine);
export type CompleteTeacherOnboardingRequest = z.infer<typeof completeTeacherOnboardingRequestSchema>;

// --- Settings edit (any subset; name editable here, not in onboarding) ------
export const updateTeacherProfileRequestSchema = z
  .object({
    fullName: z.string().trim().min(1, "الاسم مطلوب").max(200).optional(),
    phone: egyptianPhoneSchema.optional(),
    governorate: governorateSchema.optional(),
    subject: subjectSchema.optional(),
    subjectOther: z.string().trim().max(120).optional(),
  })
  .superRefine((v, ctx) => {
    subjectOtherRefine(v, ctx);
    if (v.fullName === undefined && v.phone === undefined && v.governorate === undefined && v.subject === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [], message: "لا يوجد تغيير" });
    }
  });
export type UpdateTeacherProfileRequest = z.infer<typeof updateTeacherProfileRequestSchema>;
