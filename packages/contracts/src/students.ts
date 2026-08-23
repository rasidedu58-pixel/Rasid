import { z } from "zod";
import { cursorPageSchema } from "./pagination";
import { obligationSchema } from "./finance";

/**
 * Students / Guardians / QR / Enrollment contract types — Phase 4, API
 * Contract v1.0 §9.5, §11.9, §11.10. Shared between apps/api (producer) and
 * apps/web (consumer).
 */

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

export const studentStatusSchema = z.enum(["ACTIVE", "ARCHIVED"]);
export type StudentStatus = z.infer<typeof studentStatusSchema>;

export const studentSchema = z.object({
  id: z.string().uuid(),
  studentCode: z.string(),
  name: z.string(),
  status: studentStatusSchema,
  version: z.number().int(),
});
export type Student = z.infer<typeof studentSchema>;

export const guardianLinkSchema = z.object({
  id: z.string().uuid(),
  guardianId: z.string().uuid(),
  name: z.string().nullable(),
  phone: z.string(),
  relationship: z.string().nullable(),
  isPrimary: z.boolean(),
  academicContactEnabled: z.boolean(),
  financialContactEnabled: z.boolean(),
});
export type GuardianLink = z.infer<typeof guardianLinkSchema>;

export const createStudentGuardianInputSchema = z.object({
  name: z.string().trim().min(1).optional(),
  phone: z.string().trim().min(3),
  relationship: z.string().trim().min(1).optional(),
  isPrimary: z.boolean().optional(),
  academicContactEnabled: z.boolean().optional(),
  financialContactEnabled: z.boolean().optional(),
});
export type CreateStudentGuardianInput = z.infer<typeof createStudentGuardianInputSchema>;

export const createStudentRequestSchema = z.object({
  name: z.string().trim().min(1),
  guardians: z.array(createStudentGuardianInputSchema).optional(),
});
export type CreateStudentRequest = z.infer<typeof createStudentRequestSchema>;

export const createStudentResponseSchema = z.object({
  student: studentSchema,
  guardians: z.array(guardianLinkSchema),
  qr: z.object({ credentialId: z.string().uuid(), displayToken: z.string() }),
});
export type CreateStudentResponse = z.infer<typeof createStudentResponseSchema>;

export const listStudentsResponseSchema = cursorPageSchema(studentSchema);
export type ListStudentsResponse = z.infer<typeof listStudentsResponseSchema>;

export const matchPreviewRequestSchema = z.object({
  name: z.string().trim().min(1),
  guardianPhone: z.string().trim().min(3).optional(),
});
export type MatchPreviewRequest = z.infer<typeof matchPreviewRequestSchema>;

export const matchPreviewCandidateSchema = z.object({
  studentId: z.string().uuid(),
  studentCode: z.string(),
  name: z.string(),
  matchedBy: z.enum(["NAME", "GUARDIAN_PHONE"]),
});
export type MatchPreviewCandidate = z.infer<typeof matchPreviewCandidateSchema>;

export const matchPreviewResponseSchema = z.object({
  candidates: z.array(matchPreviewCandidateSchema),
});
export type MatchPreviewResponse = z.infer<typeof matchPreviewResponseSchema>;

export const studentDetailResponseSchema = z.object({
  student: studentSchema,
  guardians: z.array(guardianLinkSchema),
  qr: z.object({ hasActive: z.boolean(), credentialId: z.string().uuid().nullable() }),
});
export type StudentDetailResponse = z.infer<typeof studentDetailResponseSchema>;

export const updateStudentRequestSchema = z.object({
  version: z.number().int(),
  name: z.string().trim().min(1).optional(),
});
export type UpdateStudentRequest = z.infer<typeof updateStudentRequestSchema>;

export const linkGuardianRequestSchema = z.object({
  guardianId: z.string().uuid().optional(),
  name: z.string().trim().min(1).optional(),
  phone: z.string().trim().min(3).optional(),
  relationship: z.string().trim().min(1).optional(),
  isPrimary: z.boolean().optional(),
  academicContactEnabled: z.boolean().optional(),
  financialContactEnabled: z.boolean().optional(),
});
export type LinkGuardianRequest = z.infer<typeof linkGuardianRequestSchema>;

export const updateStudentGuardianRequestSchema = z.object({
  relationship: z.string().trim().min(1).nullable().optional(),
  academicContactEnabled: z.boolean().optional(),
  financialContactEnabled: z.boolean().optional(),
});
export type UpdateStudentGuardianRequest = z.infer<typeof updateStudentGuardianRequestSchema>;

// ---------------------------------------------------------------------------
// QR
// ---------------------------------------------------------------------------

export const qrIssueResponseSchema = z.object({
  credentialId: z.string().uuid(),
  displayToken: z.string(),
});
export type QrIssueResponse = z.infer<typeof qrIssueResponseSchema>;

export const qrReissueRequestSchema = z.object({ reason: z.string().trim().min(1).optional() });
export type QrReissueRequest = z.infer<typeof qrReissueRequestSchema>;

export const qrResolveRequestSchema = z.object({
  token: z.string().min(1),
  context: z.enum(["GLOBAL", "SESSION", "PAYMENT"]),
});
export type QrResolveRequest = z.infer<typeof qrResolveRequestSchema>;

export const qrResolveResponseSchema = z.object({
  studentId: z.string().uuid(),
  studentCode: z.string(),
  name: z.string(),
});
export type QrResolveResponse = z.infer<typeof qrResolveResponseSchema>;

// ---------------------------------------------------------------------------
// Enrollment
// ---------------------------------------------------------------------------

export const enrollmentStatusSchema = z.enum([
  "PENDING",
  "ACTIVE",
  "STOPPED",
  "WITHDRAWN",
  "TRANSFERRED",
]);
export type EnrollmentStatus = z.infer<typeof enrollmentStatusSchema>;

export const feeMethodSchema = z.enum(["FULL_MONTH", "CUSTOM", "REMAINING_SESSIONS"]);
export type FeeMethod = z.infer<typeof feeMethodSchema>;

export const enrollmentSchema = z.object({
  id: z.string().uuid(),
  studentId: z.string().uuid(),
  groupMonthId: z.string().uuid(),
  joinDate: z.string(),
  status: enrollmentStatusSchema,
  feeMethod: feeMethodSchema,
  customFeeMinor: z.number().int().nullable(),
  version: z.number().int(),
});
export type Enrollment = z.infer<typeof enrollmentSchema>;

export const enrollmentPreviewRequestSchema = z.object({
  studentId: z.string().uuid(),
  joinDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  feeMethod: feeMethodSchema.optional(),
  customFeeMinor: z.number().int().min(0).optional(),
});
export type EnrollmentPreviewRequest = z.infer<typeof enrollmentPreviewRequestSchema>;

export const enrollmentPreviewResponseSchema = z.object({
  baseFeeMinor: z.number().int(),
  eligibleSessions: z.number().int().nullable(),
  totalBillableSessions: z.number().int().nullable(),
  calculatedDueMinor: z.number().int(),
  currency: z.string(),
  formula: feeMethodSchema,
  rounding: z.string().nullable(),
  previewToken: z.string(),
  expiresAt: z.string(),
});
export type EnrollmentPreviewResponse = z.infer<typeof enrollmentPreviewResponseSchema>;

export const enrollmentCreateRequestSchema = z.object({
  studentId: z.string().uuid(),
  joinDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  feeMethod: feeMethodSchema,
  customFeeMinor: z.number().int().min(0).optional(),
  previewToken: z.string(),
});
export type EnrollmentCreateRequest = z.infer<typeof enrollmentCreateRequestSchema>;

/**
 * Phase 6: `obligation` is now populated — API Contract §11.10's own
 * literal example names this endpoint an "Enrollment + obligation
 * transaction" (§9.5). Previously omitted (Phase 4 pre-authorized scoping
 * decision #1 — `financial_obligations` didn't exist until Phase 6, now
 * closed).
 */
export const enrollmentCreateResponseSchema = z.object({ enrollment: enrollmentSchema, obligation: obligationSchema });
export type EnrollmentCreateResponse = z.infer<typeof enrollmentCreateResponseSchema>;

export const enrollmentWithdrawRequestSchema = z.object({
  reason: z.string().trim().min(1).optional(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type EnrollmentWithdrawRequest = z.infer<typeof enrollmentWithdrawRequestSchema>;

/**
 * Phase 6: the Enrollment's obligation is echoed back (read-only — withdraw
 * never mutates it; "old debt stays independent" applies here too). `null`
 * only in the defensive case no obligation row exists for this enrollment
 * (should not happen post-Phase-6, kept nullable rather than throwing).
 */
export const enrollmentWithdrawResponseSchema = z.object({ enrollment: enrollmentSchema, obligation: obligationSchema.nullable() });
export type EnrollmentWithdrawResponse = z.infer<typeof enrollmentWithdrawResponseSchema>;

/**
 * Product Decision — Transfer Fee Method (delta closing the Phase 4
 * FULL_MONTH-default blocker): a Transfer's fee for the TARGET GroupMonth
 * is EXPLICITLY chosen by the caller, same Proration Engine as a normal
 * Enrollment. CUSTOM is deliberately excluded — Transfer is not a fee
 * re-negotiation flow (API Contract §9.5 names it "Transfer impact
 * preview"), so only the two policy-driven methods are offered.
 */
export const transferFeeMethodSchema = z.enum(["FULL_MONTH", "REMAINING_SESSIONS"]);
export type TransferFeeMethod = z.infer<typeof transferFeeMethodSchema>;

export const enrollmentTransferPreviewRequestSchema = z.object({
  targetGroupMonthId: z.string().uuid(),
  joinDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Required — no silent backend default (Product Decision, see above). */
  feeMethod: transferFeeMethodSchema,
});
export type EnrollmentTransferPreviewRequest = z.infer<typeof enrollmentTransferPreviewRequestSchema>;

export const enrollmentTransferPreviewResponseSchema = z.object({
  targetGroupMonthId: z.string().uuid(),
  targetBaseFeeMinor: z.number().int(),
  targetCurrency: z.string(),
  feeMethod: transferFeeMethodSchema,
  calculatedDueMinor: z.number().int(),
  eligibleSessions: z.number().int().nullable(),
  totalBillableSessions: z.number().int().nullable(),
  rounding: z.string().nullable(),
  previewToken: z.string(),
  expiresAt: z.string(),
});
export type EnrollmentTransferPreviewResponse = z.infer<typeof enrollmentTransferPreviewResponseSchema>;

export const enrollmentTransferRequestSchema = z.object({
  previewToken: z.string(),
  /** Required — must match the value the preview token was issued for. */
  feeMethod: transferFeeMethodSchema,
});
export type EnrollmentTransferRequest = z.infer<typeof enrollmentTransferRequestSchema>;

export const enrollmentTransferResponseSchema = z.object({
  source: enrollmentSchema,
  target: enrollmentSchema,
  /** The TARGET's obligation only — the source's own obligation (if any) is deliberately left untouched, never echoed as "changed" here. */
  obligation: obligationSchema,
});
export type EnrollmentTransferResponse = z.infer<typeof enrollmentTransferResponseSchema>;
