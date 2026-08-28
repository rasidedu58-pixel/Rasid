/**
 * Phase 15G — PII/secret scrubber for SERVER-side Sentry events (used by the
 * Next.js server runtime init in `instrumentation.ts`). Applied as the
 * server `beforeSend` hook, it is the single enforcement point that stops
 * PII/secrets leaving the server process.
 *
 * Deliberately DEPENDENCY-FREE (no pino / node:async_hooks) so it is safe in
 * any runtime, and it mirrors — field-for-field — the browser scrubber in
 * `error-tracking.ts` and the node scrubber in
 * `@academic-precision/observability` (secrets fully redacted, phones masked
 * to the last 4 digits, request body/cookies/headers dropped wholesale). The
 * existing client implementation is left untouched; this is its server twin.
 */
const SENSITIVE_KEY_PATTERN =
  /(password|passwd|secret|token|authorization|auth_token|api[_-]?key|apikey|service_role|private[_-]?key|qr(_)?raw|qr(_)?token|signature|dsn|credit[_-]?card|card[_-]?number|cvv)/i;
const MASKABLE_PII_KEY_PATTERN = /(phone|guardian_?phone|mobile)/i;
const REDACTED = "[REDACTED]";
const MAX_DEPTH = 6;

function maskPhoneLike(value: string): string {
  if (value.length <= 4) return "*".repeat(value.length);
  return `${"*".repeat(value.length - 4)}${value.slice(-4)}`;
}

function redactDeep(value: unknown, depth: number): unknown {
  if (value === null || typeof value !== "object" || depth >= MAX_DEPTH) return value;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = REDACTED;
    } else if (MASKABLE_PII_KEY_PATTERN.test(key) && typeof val === "string") {
      result[key] = maskPhoneLike(val);
    } else {
      result[key] = redactDeep(val, depth + 1);
    }
  }
  return result;
}

/** Sentry `beforeSend` hook for the server runtime. Returns the scrubbed event. */
export function scrubSentryEvent(event: Record<string, unknown>): Record<string, unknown> {
  for (const section of ["extra", "contexts", "tags", "user"] as const) {
    const value = event[section];
    if (value && typeof value === "object") {
      event[section] = redactDeep(value, 0);
    }
  }
  // Never send request bodies/cookies/headers wholesale — keep only method + query-stripped url.
  const request = event.request as Record<string, unknown> | undefined;
  if (request && typeof request === "object") {
    event.request = {
      method: request.method,
      url: typeof request.url === "string" ? request.url.split("?")[0] : undefined,
    };
  }
  return event;
}
