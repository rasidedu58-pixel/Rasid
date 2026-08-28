/**
 * Phase 15G — Next.js server-runtime Sentry init (the official
 * `instrumentation.ts` register hook; enabled for Next 14 by
 * `withSentryConfig` in next.config.mjs). Captures server runtime errors,
 * RSC/server-rendering errors, and route-handler/server exceptions — the
 * latter two via the build-time wrapping `withSentryConfig` adds.
 *
 * Constraints (kept identical to the browser tracker):
 *  - GATED on a DSN. No DSN → returns immediately, a pure no-op.
 *  - Reads the server DSN as `SENTRY_DSN` (server-only override) falling back
 *    to `NEXT_PUBLIC_SENTRY_DSN` (already configured for the browser). A
 *    Sentry DSN is a public, write-only ingest key — not a secret — so the
 *    fallback exposes nothing new; nothing server-only is ever sent to the
 *    browser.
 *  - ERRORS ONLY: `tracesSampleRate: 0` (tracing off) and no
 *    replay/profiling/logs/metrics/performance integrations are added.
 *  - PII SCRUBBING via `beforeSend` (see ./lib/sentry-scrub) — equivalent to
 *    the browser + node scrubbers.
 */
export async function register(): Promise<void> {
  // This app has no edge runtime (no middleware / no `export const runtime = "edge"`).
  // Initialise only for the Node.js server runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return; // no-op when Sentry is not configured

  const Sentry = await import("@sentry/nextjs");
  const { scrubSentryEvent } = await import("./lib/sentry-scrub");

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE ?? process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    tracesSampleRate: 0, // tracing/performance disabled
    beforeSend: (event) => {
      // scrubSentryEvent mutates in place; cast for the dependency-free
      // scrubber, then return the same (now scrubbed) typed Sentry event.
      scrubSentryEvent(event as unknown as Record<string, unknown>);
      return event;
    },
  });
}
