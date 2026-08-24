import pino, { type Logger, type LoggerOptions } from "pino";
import { redactLogObject } from "./redact";

/**
 * Structured logging factory built on pino.
 *
 * Phase 10 — every log call is passed through `redactLogObject` (a pino
 * `formatters.log` hook) BEFORE serialization: secrets (passwords, tokens,
 * QR raw values, API keys, signatures) are fully redacted, PII (guardian
 * phone numbers) is masked, not removed. This is the ONE enforcement point
 * for API Contract §18's "Logs/Errors/Audit لا تحتوي password، auth token،
 * QR raw token، billing secrets أو PII زائد عن الحاجة" — callers never need
 * to remember to scrub a field by hand before logging it.
 *
 * `options.formatters.log`, if a caller supplies one, WINS over this
 * default (pino merges `options` after the base config below) — pass a
 * composed formatter if a caller genuinely needs both.
 */
export function createLogger(name: string, options: LoggerOptions = {}): Logger {
  return pino({
    name,
    level: process.env.LOG_LEVEL ?? "info",
    formatters: { log: redactLogObject },
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
