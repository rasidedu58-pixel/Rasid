/**
 * Browser (Next.js app-router) Sentry error tracking — real but DSN-gated.
 *
 * Mirrors the server-side `@academic-precision/observability` Sentry wiring,
 * but for the client bundle:
 *
 *  - GATED on `NEXT_PUBLIC_SENTRY_DSN`. Unset → no-op (single debug line);
 *    `captureException()` becomes a silent no-op.
 *  - `@sentry/nextjs` is an OPTIONAL dependency. The import is dynamic and
 *    uses a NON-LITERAL specifier so `tsc`/`next build` never fail when the
 *    package is absent, and it is `.catch`-guarded so a missing package
 *    degrades to a no-op instead of breaking the app. Install later with:
 *      pnpm add @sentry/nextjs -F @academic-precision/web
 *  - PII SCRUBBING: a `beforeSend` hook strips request bodies and redacts
 *    the same sensitive field names the server redactor handles, so no
 *    student/guardian PII, token, or secret is sent from the browser. The
 *    redaction list is inlined here (rather than imported from the
 *    node-only observability package) to keep pino/node:async_hooks out of
 *    the client bundle.
 */

/** Loose local shape of the parts of `@sentry/nextjs` we call. */
interface SentryScopeLike {
  setExtras(extras: Record<string, unknown>): void;
}
interface SentryClientLike {
  init(options: Record<string, unknown>): void;
  captureException(error: unknown): string;
  withScope(callback: (scope: SentryScopeLike) => void): void;
}

let sentry: SentryClientLike | null = null;

/** Non-literal specifier: keeps `tsc`/bundler from resolving the module. */
const SENTRY_NEXTJS_MODULE = "@sentry/nextjs";

// Kept in sync with packages/observability/src/redact.ts.
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

function scrubEvent(event: Record<string, unknown>): Record<string, unknown> {
  for (const section of ["extra", "contexts", "tags", "user"] as const) {
    const value = event[section];
    if (value && typeof value === "object") {
      event[section] = redactDeep(value, 0);
    }
  }
  const request = event.request as Record<string, unknown> | undefined;
  if (request && typeof request === "object") {
    event.request = {
      url: typeof request.url === "string" ? request.url.split("?")[0] : undefined,
    };
  }
  return event;
}

function debug(message: string): void {
  if (process.env.NODE_ENV === "development") {
    // eslint-disable-next-line no-console
    console.debug(`[error-tracking] ${message}`);
  }
}

function resolveSampleRate(): number {
  const raw = process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE;
  if (raw === undefined) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0;
}

/**
 * Initialise browser error tracking. Idempotent; safe to call from a root
 * layout / client provider unconditionally. No-op unless
 * `NEXT_PUBLIC_SENTRY_DSN` is set and `@sentry/nextjs` is installed.
 */
export async function initErrorTracking(): Promise<void> {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) {
    debug("error tracking disabled (NEXT_PUBLIC_SENTRY_DSN unset)");
    return;
  }
  if (sentry) return;

  const loaded = (await import(SENTRY_NEXTJS_MODULE).catch(() => null)) as SentryClientLike | null;
  if (!loaded || typeof loaded.init !== "function") {
    debug("NEXT_PUBLIC_SENTRY_DSN is set but '@sentry/nextjs' is not installed — staying no-op");
    return;
  }

  loaded.init({
    dsn,
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    tracesSampleRate: resolveSampleRate(),
    beforeSend: (event: Record<string, unknown>) => scrubEvent(event),
  });

  sentry = loaded;
  debug("Sentry browser error tracking initialized");
}

/**
 * Capture an exception from client code with PII scrubbing. Silent no-op
 * until `initErrorTracking()` has wired a real client.
 */
export function captureException(error: unknown, extra?: Record<string, unknown>): void {
  const client = sentry;
  if (!client) return;
  client.withScope((scope) => {
    if (extra) scope.setExtras(redactDeep(extra, 0) as Record<string, unknown>);
    client.captureException(error);
  });
}
