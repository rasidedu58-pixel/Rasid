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
