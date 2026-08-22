import pino, { type Logger, type LoggerOptions } from "pino";

/**
 * Structured logging factory built on pino.
 *
 * Foundation-only: no product-specific fields are baked in here. Callers
 * attach correlation/request/job context via `withContext`.
 */
export function createLogger(name: string, options: LoggerOptions = {}): Logger {
  return pino({
    name,
    level: process.env.LOG_LEVEL ?? "info",
    ...options,
  });
}

/**
 * Returns a child logger carrying arbitrary structured context (e.g.
 * requestId, jobId, workspaceId) without mutating the parent logger.
 */
export function withContext(logger: Logger, context: Record<string, unknown>): Logger {
  return logger.child(context);
}
