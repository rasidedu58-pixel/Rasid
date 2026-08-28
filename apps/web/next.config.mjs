import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Real root cause of an earlier "Unsupported Server Component type:
  // undefined" crash (Phase 11 manual QA): packages/ui originally built to
  // CommonJS, and tsc's CJS emit prepends `"use strict";` BEFORE the
  // original `"use client";` directive — since a directive must be the
  // file's literal first statement to be recognized, that pushed "use
  // client" out of position and Next's RSC boundary detection silently
  // missed it. Fixed at the source: packages/ui now builds to ESM
  // (module:"ESNext" in its own tsconfig), where no "use strict" prologue
  // is ever emitted, so "use client" stays first. `transpilePackages` is
  // still required so Next's own compiler processes that ESM source.
  transpilePackages: ["@academic-precision/contracts", "@academic-precision/config", "@academic-precision/ui"],
};

/**
 * Phase 15G — `withSentryConfig` is REQUIRED (not optional) for server-side
 * error capture on Next.js 14.2: it enables the `instrumentation.ts` register
 * hook (Next 14 needs `experimental.instrumentationHook`, which this wrapper
 * sets automatically) and adds the build-time wrapping of App Router
 * pages/RSC and route handlers/server functions so their thrown errors are
 * reported. Without it, only uncaught process errors would be captured and
 * most RSC/route errors (which Next catches internally) would be missed.
 *
 * Everything optional is turned OFF to stay minimal and cost-safe: no
 * source-map upload (out of scope — no auth token used), no Sentry build
 * telemetry, no tunnel route, no Vercel cron monitors, and the runtime logger
 * is tree-shaken. Tracing/replay/profiling are controlled in the SDK init
 * (tracesSampleRate 0), not here.
 */
export default withSentryConfig(nextConfig, {
  silent: true,
  telemetry: false,
  disableLogger: true,
  sourcemaps: { disable: true },
});
