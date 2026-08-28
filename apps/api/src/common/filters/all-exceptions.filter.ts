import { ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { captureException, createLogger } from "@academic-precision/observability";
import { REQUEST_ID_HEADER } from "../middleware/request-id.middleware";

const logger = createLogger("api:unhandled-exceptions");

/**
 * Phase 15G — decides whether an exception is a genuine server fault worth a
 * Sentry alert, or expected product behaviour that must NOT create noise.
 *
 * - A non-`HttpException` is always an unexpected server fault → report.
 * - An `HttpException` is reported ONLY when its status is 5xx. Every 4xx —
 *   400 validation, 401, 403, 404, the expected 409 optimistic-version
 *   conflict, 429 rate limiting — is normal, caller-driven behaviour and is
 *   deliberately never sent to Sentry.
 */
export function shouldReportToSentry(status: number, isHttpException: boolean): boolean {
  if (!isHttpException) return true;
  return status >= 500;
}

/**
 * Global exception filter mapping every thrown error to the approved API
 * error contract (API Contract v1.0):
 *
 * {
 *   "error": { "code": "STRING_CODE", "message": "human message", "details": {} },
 *   "requestId": "req_..."
 * }
 *
 * Any exception that isn't a recognized `ApiException`/`HttpException` maps
 * to a generic 500 `INTERNAL_SERVER_ERROR` in the response body (per API
 * Contract §12 — the client never sees stack traces/internals), but is
 * logged server-side with its requestId so it's actually diagnosable —
 * silently swallowing unexpected 500s makes production incidents
 * undebuggable.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const requestId = String(request.headers[REQUEST_ID_HEADER] ?? "req_unknown");

    const { status, code, message, details } = this.mapException(exception);
    const isHttp = exception instanceof HttpException;

    if (!isHttp) {
      logger.error({ err: exception, requestId, path: request.url }, "Unhandled exception");
    }

    // §4 — forward only genuine server faults (unexpected errors + explicit
    // 5xx) to Sentry; expected 4xx product behaviour is never reported. The
    // attached context is safe by construction: requestId, route (query
    // stripped), method, status — no headers, cookies, tokens, or body. The
    // observability `beforeSend` scrubs it again as defence in depth.
    if (shouldReportToSentry(status, isHttp)) {
      captureException(exception, {
        requestId,
        route: typeof request.url === "string" ? request.url.split("?")[0] : undefined,
        method: request.method,
        status,
      });
    }

    response.status(status).send({
      error: { code, message, details },
      requestId,
    });
  }

  private mapException(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const bodyObject = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : undefined;
      const message =
        typeof body === "string" ? body : ((bodyObject?.message as string | undefined) ?? exception.message);

      // Domain/API-level exceptions (see ApiException) carry an explicit
      // error-catalog `code` in their response body — honor it over the
      // generic HTTP-status-derived code so 401/403/404/422 map to the
      // exact codes required by API Contract §12 (e.g. UNAUTHENTICATED vs
      // SESSION_EXPIRED, RESOURCE_NOT_FOUND, VALIDATION_ERROR).
      const explicitCode = typeof bodyObject?.code === "string" ? bodyObject.code : undefined;
      const details = bodyObject?.details as Record<string, unknown> | undefined;

      return {
        status,
        code: explicitCode ?? this.statusToCode(status),
        message,
        details: details ?? (explicitCode ? undefined : bodyObject),
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred.",
    };
  }

  private statusToCode(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return "BAD_REQUEST";
      case HttpStatus.UNAUTHORIZED:
        return "UNAUTHORIZED";
      case HttpStatus.FORBIDDEN:
        return "FORBIDDEN";
      case HttpStatus.NOT_FOUND:
        return "NOT_FOUND";
      case HttpStatus.CONFLICT:
        return "CONFLICT";
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return "UNPROCESSABLE_ENTITY";
      default:
        return "INTERNAL_SERVER_ERROR";
    }
  }
}
