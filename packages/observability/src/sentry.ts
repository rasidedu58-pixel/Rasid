/**
 * Real (but DSN-gated) Sentry error tracking for the Node runtimes
 * (apps/api, apps/worker).
 *
 * Design constraints (see SENTRY.md):
 *
 *  1. DSN-GATED / NO-OP WHEN ABSENT. `initErrorTracking()` does nothing
 *     unless `SENTRY_DSN` is set. With no DSN the whole module degrades to
 *     the existing `createNoopErrorReporter()` behaviour — a single debug
 *     line, and `captureException()` becomes a silent no-op. Nothing here
 *     ever throws just because Sentry is unconfigured.
 *
 *  2. OPTIONAL DEPENDENCY. `@sentry/node` is NOT installed yet. The import
 *     is dynamic AND uses a NON-LITERAL specifier so `tsc` never tries to
 *     resolve the module (it types the result as `any`), and it is wrapped
 *     in `.catch(() => null)` so a missing package at runtime degrades to a
 *     no-op instead of crashing the process. Install later with:
 *       pnpm add @sentry/node -F @academic-precision/api -F @academic-precision/worker
 *
 *  3. PII SCRUBBING. A `beforeSend` hook runs every outgoing event through
 *     the SAME `redactLogObject` field list used for structured logs, and
 *     drops request bodies wholesale, so student/guardian PII, tokens, QR
 *     raw values and billing secrets never reach Sentry.
 *
 *  4. CORRELATION CONTEXT. requestId/jobId/userId/workspaceId from the
 *     AsyncLocalStorage `getContext()` store are attached as Sentry tags
 *     (and a `correlation` context) on every captured event.
 */
import { getContext } from "./context";
import { redactLogObject } from "./redact";
import { createNoopErrorReporter, type ErrorReporter } from "./adapters";

/**
 * Minimal, deliberately-loose shape of the bits of `@sentry/node` we use.
 * Declared locally so this file typechecks with the dependency absent.
 */
interface SentryScopeLike {
  setTag(key: string, value: string): void;
  setContext(name: string, context: Record<string, unknown> | null): void;
  setExtras(extras: Record<string, unknown>): void;
}

interface SentryLike {
  init(options: Record<string, unknown>): void;
  captureException(error: unknown, hint?: unknown): string;
  withScope(callback: (scope: SentryScopeLike) => void): void;
  flush?(timeout?: number): Promise<boolean>;
}

/** Loaded lazily by `initErrorTracking()`; null = not (yet) initialized. */
let sentry: SentryLike | null = null;

/** Non-literal specifier: keeps `tsc` from resolving/checking the module. */
const SENTRY_NODE_MODULE = "@sentry/node";

function debug(message: string): void {
  if (process.env.OBSERVABILITY_DEBUG === "1" || process.env.NODE_ENV === "development") {
    // eslint-disable-next-line no-console
    console.debug(`[observability] ${message}`);
  }
}

/** Correlation tags/context pulled from the AsyncLocalStorage store. */
function correlationFields(): Record<string, string> {
  const ctx = getContext();
  if (!ctx) return {};
  const fields: Record<string, string> = {};
  for (const key of ["requestId", "jobId", "userId", "workspaceId"] as const) {
    const value = ctx[key];
    if (typeof value === "string" && value.length > 0) fields[key] = value;
  }
  return fields;
}

/**
 * `beforeSend` hook — the single enforcement point that stops PII/secrets
 * leaving the process. Runs EVERY outgoing event (including ones Sentry's
 * own global handlers capture automatically) through `redactLogObject`, and
 * drops request bodies wholesale.
 */
export function scrubEvent(event: Record<string, unknown>): Record<string, unknown> {
  // Redact known-sensitive keys anywhere in the structured payload.
  for (const section of ["extra", "contexts", "tags", "user"] as const) {
    const value = event[section];
    if (value && typeof value === "object") {
      event[section] = redactLogObject(value as Record<string, unknown>);
    }
  }

  // Never send request bodies/cookies/headers wholesale; keep only method + url.
  const request = event.request as Record<string, unknown> | undefined;
  if (request && typeof request === "object") {
    event.request = {
      method: request.method,
      url: typeof request.url === "string" ? request.url.split("?")[0] : undefined,
    };
  }

  // Enrich with correlation context if the automatic capture path missed it.
  const fields = correlationFields();
  if (Object.keys(fields).length > 0) {
    const tags = (event.tags as Record<string, unknown> | undefined) ?? {};
    event.tags = { ...fields, ...tags };
    const contexts = (event.contexts as Record<string, unknown> | undefined) ?? {};
    event.contexts = { correlation: fields, ...contexts };
  }

  return event;
}

function resolveSampleRate(): number {
  const raw = process.env.SENTRY_TRACES_SAMPLE_RATE;
  if (raw === undefined) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0;
}

/**
 * Initialise Sentry for a Node runtime. Idempotent and safe to call
 * unconditionally at process bootstrap.
 *
 * - No `SENTRY_DSN`  → no-op (single debug line), returns the no-op reporter.
 * - `@sentry/node` missing at runtime → no-op, returns the no-op reporter.
 * - Otherwise → real Sentry, returns a reporter backed by it.
 *
 * `serviceName` is attached as a `service` tag so api/worker events are
 * distinguishable in one Sentry project.
 */
export async function initErrorTracking(serviceName: string): Promise<ErrorReporter> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    debug(`error tracking disabled (SENTRY_DSN unset) for "${serviceName}"`);
    return createNoopErrorReporter();
  }
  if (sentry) return errorReporter;

  const loaded = (await import(SENTRY_NODE_MODULE).catch(() => null)) as SentryLike | null;
  if (!loaded || typeof loaded.init !== "function") {
    debug(`SENTRY_DSN is set but "@sentry/node" is not installed — staying no-op`);
    return createNoopErrorReporter();
  }

  loaded.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: resolveSampleRate(),
    initialScope: { tags: { service: serviceName } },
    beforeSend: (event: Record<string, unknown>) => scrubEvent(event),
  });

  sentry = loaded;
  debug(`Sentry error tracking initialized for "${serviceName}"`);
  return errorReporter;
}

/**
 * Whether a REAL Sentry client is currently wired (DSN present AND
 * `@sentry/node` actually loaded). This is the honest signal a verification
 * step needs: it is `false` for every no-op path, so a test harness can
 * distinguish "SDK active, event genuinely sent" from "silently did nothing".
 */
export function isErrorTrackingActive(): boolean {
  return sentry !== null;
}

/**
 * Capture an exception with correlation context + PII scrubbing. A silent
 * no-op until `initErrorTracking()` has successfully wired a real client.
 * Safe to import and call from anywhere. Returns Sentry's event id when a
 * real client actually accepted the event, or `undefined` on any no-op path.
 */
export function captureException(error: unknown, extra?: Record<string, unknown>): string | undefined {
  const client = sentry;
  if (!client) return undefined;

  let eventId: string | undefined;
  client.withScope((scope) => {
    const fields = correlationFields();
    for (const [key, value] of Object.entries(fields)) scope.setTag(key, value);
    if (Object.keys(fields).length > 0) scope.setContext("correlation", fields);
    if (extra) scope.setExtras(redactLogObject(extra) as Record<string, unknown>);
    eventId = client.captureException(error);
  });
  return eventId;
}

/**
 * Flush buffered events (call before a graceful shutdown). Returns `true`
 * only when a real client flushed successfully within the timeout — `false`
 * on timeout or when error tracking is not active.
 */
export async function flushErrorTracking(timeoutMs = 2000): Promise<boolean> {
  if (sentry?.flush) {
    return sentry.flush(timeoutMs).catch(() => false);
  }
  return false;
}

/**
 * Reporter backed by the module-level Sentry client — a drop-in for the
 * `ErrorReporter` interface that no-ops until `initErrorTracking()` runs.
 */
export const errorReporter: ErrorReporter = {
  captureException(error, context) {
    captureException(error, context);
  },
};
