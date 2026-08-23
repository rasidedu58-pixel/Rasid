import { HttpException } from "@nestjs/common";

/**
 * Exception carrying an explicit API Contract §12 error-catalog `code`,
 * honored verbatim by `AllExceptionsFilter` instead of the generic
 * HTTP-status-derived code. Use this (or a subclass below) instead of
 * throwing bare `HttpException`/`UnauthorizedException`/etc. whenever the
 * contract specifies a precise code.
 */
export class ApiException extends HttpException {
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super({ code, message, details }, status);
  }
}

export class UnauthenticatedException extends ApiException {
  constructor(message = "لا توجد جلسة مصادق عليها صالحة.") {
    super(401, "UNAUTHENTICATED", message);
  }
}

export class SessionExpiredException extends ApiException {
  constructor(message = "انتهت صلاحية الجلسة. يرجى تسجيل الدخول مجددًا.") {
    super(401, "SESSION_EXPIRED", message);
  }
}

export class ForbiddenApiException extends ApiException {
  constructor(message = "غير مسموح بتنفيذ هذا الإجراء.") {
    super(403, "FORBIDDEN", message);
  }
}

/**
 * Safe no-leak 404 — used both for "does not exist" and "exists but the
 * caller has no membership", per API Contract §5.2/§12: existence of a
 * resource outside the caller's scope must never be confirmed.
 */
export class ResourceNotFoundException extends ApiException {
  constructor(message = "المورد غير موجود.") {
    super(404, "RESOURCE_NOT_FOUND", message);
  }
}

export class ValidationApiException extends ApiException {
  constructor(fieldErrors: Record<string, string[]>, message = "بيانات غير صالحة.") {
    super(422, "VALIDATION_ERROR", message, { fieldErrors });
  }
}

/**
 * 422 — a requested permission grant is incoherent: an unknown permission
 * key, a scope that violates the catalog's required scope kind, or (Phase 2
 * §7) a SELECTED_GROUPS group id that the GroupOwnershipPort reports does
 * NOT belong to the grant's workspace.
 */
export class PermissionScopeInvalidException extends ApiException {
  constructor(message = "نطاق الصلاحية غير صالح.", details?: Record<string, unknown>) {
    super(422, "PERMISSION_SCOPE_INVALID", message, details);
  }
}

/** 409 — Database Schema INT-01: a (workspace, year, month) OperatingMonth already exists. */
export class MonthAlreadyExistsException extends ApiException {
  constructor(message = "يوجد شهر تشغيلي بنفس السنة والشهر بالفعل.", details?: Record<string, unknown>) {
    super(409, "MONTH_ALREADY_EXISTS", message, details);
  }
}

/**
 * 422 — the CreateMonth transaction could not complete: an invalid/expired
 * preview token, a source-state change since preview, or a validation
 * failure. API Contract §12 also allows 500 for a genuine unexpected
 * failure — that case is left to the generic INTERNAL_ERROR path instead of
 * this exception.
 */
export class MonthCreateFailedException extends ApiException {
  constructor(message = "تعذر إنشاء الشهر.", details?: Record<string, unknown>) {
    super(422, "MONTH_CREATE_FAILED", message, details);
  }
}

/** 409 — the requested action is not valid for the session's current status. */
export class SessionInvalidStateException extends ApiException {
  constructor(message = "الإجراء غير صالح لحالة الحصة الحالية.", details?: Record<string, unknown>) {
    super(409, "SESSION_INVALID_STATE", message, details);
  }
}

/** 409 — optimistic concurrency: the record changed since it was last read. */
export class VersionConflictException extends ApiException {
  constructor(message = "تم تعديل السجل من مستخدم آخر. يرجى إعادة التحميل.", details?: Record<string, unknown>) {
    super(409, "VERSION_CONFLICT", message, details);
  }
}

/** 409 — same Idempotency-Key + operation but a different request payload. */
export class IdempotencyConflictException extends ApiException {
  constructor(message = "نفس مفتاح idempotency باستخدام بيانات مختلفة.", details?: Record<string, unknown>) {
    super(409, "IDEMPOTENCY_CONFLICT", message, details);
  }
}

/** 422 — API Contract §12 error catalog: student not eligible for the requested session/date/enrollment action. */
export class EnrollmentNotEligibleException extends ApiException {
  constructor(message = "طالب غير مؤهل للحصة/التاريخ.", details?: Record<string, unknown>) {
    super(422, "ENROLLMENT_NOT_ELIGIBLE", message, details);
  }
}

/** 422 — API Contract §12 error catalog: no enabled/valid guardian for the requested contact channel. */
export class GuardianContactDisabledException extends ApiException {
  constructor(message = "لا يوجد ولي أمر مفعّل صالح لهذه القناة.", details?: Record<string, unknown>) {
    super(422, "GUARDIAN_CONTACT_DISABLED", message, details);
  }
}

/**
 * 404 — API Contract §12: QR token unknown/revoked/out-of-scope. Deliberately
 * a single response shape for all three cases (safe no-leak — API Contract
 * §18: never distinguish "unknown" from "revoked" from "belongs to another
 * workspace" in the response).
 */
export class QrInvalidException extends ApiException {
  constructor(message = "رمز QR غير معروف.", details?: Record<string, unknown>) {
    super(404, "QR_INVALID", message, details);
  }
}

/**
 * 409 — a student already has an ACTIVE QR credential; `/qr/issue` is
 * "issue if no active QR" per the API Contract §9.5 registry. Not in the
 * approved error catalog verbatim (documented Phase 4 deviation — the
 * registry implies reissue is the intended path when one already exists,
 * but does not name a dedicated code for issue-while-active) — a new,
 * clearly-named 409 code was the least surprising choice available, rather
 * than overloading an unrelated existing code.
 */
export class QrAlreadyActiveException extends ApiException {
  constructor(message = "يوجد رمز QR فعّال بالفعل لهذا الطالب. استخدم إعادة الإصدار بدلاً من ذلك.", details?: Record<string, unknown>) {
    super(409, "QR_ALREADY_ACTIVE", message, details);
  }
}

/**
 * 422 — API Contract §12/PRD §34: `complete_session_with_missing_records`
 * is False (Phase 5 hardcoded default — see `SessionModeService` doc
 * comment) and at least one required record (attendance/homework) is still
 * missing. `NO_HOMEWORK`/`ABSENT_FROM_EXAM` are resolved states, never
 * counted as missing.
 */
export class SessionRecordsMissingException extends ApiException {
  constructor(message = "توجد سجلات مطلوبة ناقصة قبل إنهاء الحصة.", details?: Record<string, unknown>) {
    super(422, "SESSION_RECORDS_MISSING", message, details);
  }
}

/**
 * 409 — API Contract §12: `POST /sessions/{id}/complete` called again with a
 * genuinely different Idempotency-Key (not a byte-identical replay, which
 * instead returns the cached 200 response) against a Session that is
 * already COMPLETED. No effects are re-run.
 */
export class SessionAlreadyCompletedException extends ApiException {
  constructor(message = "هذه الحصة مكتملة بالفعل.", details?: Record<string, unknown>) {
    super(409, "SESSION_ALREADY_COMPLETED", message, details);
  }
}

/**
 * 422 — API Contract §7.5/§17: a batch write (attendance/homework/exam
 * scores) rejected because at least one row was invalid (out-of-roster
 * enrollment, wrong GroupMonth, etc.) — the WHOLE batch is rolled back, no
 * partial write ever committed.
 */
export class BatchValidationFailedException extends ApiException {
  constructor(message = "فشل التحقق من دفعة السجلات؛ لم يتم حفظ أي صف.", details?: Record<string, unknown>) {
    super(422, "BATCH_VALIDATION_FAILED", message, details);
  }
}

/** 422 — API Contract §12: exam score outside [0, max_score]. No partial save. */
export class ExamScoreOutOfRangeException extends ApiException {
  constructor(message = "الدرجة خارج النطاق المسموح.", details?: Record<string, unknown>) {
    super(422, "EXAM_SCORE_OUT_OF_RANGE", message, details);
  }
}

/** 422 — API Contract §12: payment amount <= 0 or currency mismatch. */
export class PaymentInvalidAmountException extends ApiException {
  constructor(message = "مبلغ الدفعة غير صالح.", details?: Record<string, unknown>) {
    super(422, "PAYMENT_INVALID_AMOUNT", message, details);
  }
}

/** 422 — API Contract §12: amount > obligation's remaining balance. No overpayment/credit balance in V1. */
export class PaymentExceedsRemainingException extends ApiException {
  constructor(message = "المبلغ أكبر من المتبقي على هذا الاستحقاق.", details?: Record<string, unknown>) {
    super(422, "PAYMENT_EXCEEDS_REMAINING", message, details);
  }
}

/** 409 — API Contract §12: a Payment may be reversed at most once (V1). */
export class PaymentAlreadyReversedException extends ApiException {
  constructor(message = "تم عكس هذه الدفعة بالفعل.", details?: Record<string, unknown>) {
    super(409, "PAYMENT_ALREADY_REVERSED", message, details);
  }
}

/** 409 — API Contract §12: the obligation's current state does not allow a payment (e.g. already PAID). */
export class ObligationNotPayableException extends ApiException {
  constructor(message = "لا يمكن تسجيل دفعة على هذا الاستحقاق في حالته الحالية.", details?: Record<string, unknown>) {
    super(409, "OBLIGATION_NOT_PAYABLE", message, details);
  }
}

/**
 * 422 — Phase 6 Closure Delta: a carried-forward group has no resolvable due
 * day (neither its own `dueDay` nor the workspace's `unifiedDueDay` is
 * set), so no obligation `due_date` can be computed for its continuing
 * students.
 */
export class CarryForwardDueDayUnresolvedException extends ApiException {
  constructor(
    message = "تعذر تحديد يوم استحقاق الرسوم لمجموعة مُرحّلة، ولا يمكن إنشاء استحقاقات طلابها المستمرين.",
    details?: Record<string, unknown>,
  ) {
    super(422, "CARRY_FORWARD_DUE_DAY_UNRESOLVED", message, details);
  }
}

/** 409 — Phase 7, API Contract §12: an AttentionCase/ScheduledFollowUp status transition is not allowed from its current state. Returns the current state so the caller can reconcile. */
export class AttentionCaseInvalidStateException extends ApiException {
  constructor(message = "الإجراء غير صالح لحالة الحالة الحالية.", details?: Record<string, unknown>) {
    super(409, "ATTENTION_CASE_INVALID_STATE", message, details);
  }
}

/** 409 — Phase 7, API Contract §12: a ScheduledFollowUp status transition (complete/reschedule) is not allowed from its current state (e.g. already DONE/CANCELLED). */
export class FollowupInvalidStateException extends ApiException {
  constructor(message = "الإجراء غير صالح لحالة المتابعة الحالية.", details?: Record<string, unknown>) {
    super(409, "FOLLOWUP_INVALID_STATE", message, details);
  }
}
