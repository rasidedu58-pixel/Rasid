import { ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { REQUEST_ID_HEADER } from "../middleware/request-id.middleware";

/**
 * Global exception filter mapping every thrown error to the approved API
 * error contract (API Contract v1.0):
 *
 * {
 *   "error": { "code": "STRING_CODE", "message": "human message", "details": {} },
 *   "requestId": "req_..."
 * }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const requestId = String(request.headers[REQUEST_ID_HEADER] ?? "req_unknown");

    const { status, code, message, details } = this.mapException(exception);

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
      const message =
        typeof body === "string" ? body : ((body as { message?: string }).message ?? exception.message);

      return {
        status,
        code: this.statusToCode(status),
        message,
        details: typeof body === "object" ? (body as Record<string, unknown>) : undefined,
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
