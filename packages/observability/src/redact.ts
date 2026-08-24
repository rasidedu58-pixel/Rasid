/**
 * Phase 10 — PII/secret redaction for structured logs.
 *
 * API Contract §18 Security Contract: "Logs/Errors/Audit لا تحتوي password،
 * auth token، QR raw token، billing secrets أو PII زائد عن الحاجة" and
 * "Guardian phone يُmask عندما Permission لا تحتاج القيمة الكاملة." This
 * was a documented requirement with NO enforcement in code before Phase 10
 * (the `packages/observability` foundation had structured logging +
 * correlation IDs, but no redaction at all).
 *
 * Applied as a pino `formatters.log` hook (see `logger.ts`) — runs on
 * EVERY log call, so the key-name check is deliberately cheap (a
 * pre-compiled regex test, not a lookup table scan) and recursion is
 * depth-bounded (object logging is metadata, not deeply nested domain
 * dumps — 6 levels comfortably covers any realistic log payload while
 * bounding worst-case cost).
 */
const SENSITIVE_KEY_PATTERN =
  /(password|passwd|secret|token|authorization|auth_token|api[_-]?key|apikey|service_role|private[_-]?key|qr(_)?raw|qr(_)?token|signature|dsn|credit[_-]?card|card[_-]?number|cvv)/i;

/** Keys that are PII (not secrets) — masked, not fully redacted, matching "Guardian phone يُmask" (partial visibility can still be useful for support, unlike a secret which must never appear at all). */
const MASKABLE_PII_KEY_PATTERN = /(phone|guardian_?phone|mobile)/i;

const REDACTED = "[REDACTED]";
const MAX_DEPTH = 6;

function maskPhoneLike(value: string): string {
  if (value.length <= 4) return "*".repeat(value.length);
  return `${"*".repeat(value.length - 4)}${value.slice(-4)}`;
}

function redactValue(key: string, value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;

  if (SENSITIVE_KEY_PATTERN.test(key)) return REDACTED;
  if (MASKABLE_PII_KEY_PATTERN.test(key) && typeof value === "string") return maskPhoneLike(value);

  if (depth >= MAX_DEPTH) return value;

  if (Array.isArray(value)) {
    return value.map((item) => redactObjectDeep(item, depth + 1));
  }
  if (typeof value === "object") {
    return redactObjectDeep(value, depth + 1);
  }
  return value;
}

function redactObjectDeep(obj: unknown, depth: number): unknown {
  if (obj === null || typeof obj !== "object" || depth >= MAX_DEPTH) return obj;
  if (Array.isArray(obj)) return obj.map((item) => redactObjectDeep(item, depth + 1));

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    result[key] = redactValue(key, value, depth);
  }
  return result;
}

/**
 * pino `formatters.log` hook — every log call's merged object passes
 * through this before serialization. Top-level pino fields (`level`,
 * `time`, `msg`, `pid`, `hostname`) are never object-shaped and pass
 * through the cheap key-name check unaffected (none match the sensitive
 * pattern).
 */
export function redactLogObject(obj: Record<string, unknown>): Record<string, unknown> {
  return redactObjectDeep(obj, 0) as Record<string, unknown>;
}
