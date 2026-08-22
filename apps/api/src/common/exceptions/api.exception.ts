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
