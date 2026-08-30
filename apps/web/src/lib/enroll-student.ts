import type { EnrollmentCreateResponse, FeeMethod, GroupMonth } from "@academic-precision/contracts";
import { previewEnrollment, createEnrollment } from "./api/students";

/**
 * Enroll ONE existing student into a GroupMonth via the canonical two-step
 * (preview → create) — the same sequence `EnrollStudentDialog` uses, extracted
 * so every entry point (fast-add, group sheet) shares it instead of copying the
 * token dance. Fee-method handling mirrors the backend `resolveFeeMethod`
 * exactly: only ASK_EVERY_TIME groups take a caller-chosen method; FULL/
 * REMAINING groups force theirs (the create call echoes `preview.formula`), so
 * we never invent a silent fee default.
 */
export async function enrollStudentIntoGroupMonth(
  workspaceId: string,
  groupMonth: GroupMonth,
  params: { studentId: string; joinDate: string; feeMethod?: FeeMethod; customFeeMinor?: number },
): Promise<EnrollmentCreateResponse> {
  const ask = groupMonth.joinFeePolicy === "ASK_EVERY_TIME";
  const preview = await previewEnrollment(workspaceId, groupMonth.id, {
    studentId: params.studentId,
    joinDate: params.joinDate,
    feeMethod: ask ? params.feeMethod : undefined,
    customFeeMinor: ask && params.feeMethod === "CUSTOM" ? params.customFeeMinor : undefined,
  });
  return createEnrollment(workspaceId, groupMonth.id, {
    studentId: params.studentId,
    joinDate: params.joinDate,
    feeMethod: ask ? (params.feeMethod ?? "FULL_MONTH") : preview.formula,
    customFeeMinor: ask && params.feeMethod === "CUSTOM" ? params.customFeeMinor : undefined,
    previewToken: preview.previewToken,
  });
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
