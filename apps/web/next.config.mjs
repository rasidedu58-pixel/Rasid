import { withSentryConfig } from "@sentry/nextjs";
import withSerwistInit from "@serwist/next";
import { fileURLToPath } from "node:url";

/**
 * Offline-First (§16) — Serwist compiles `src/app/sw.ts` into `public/sw.js` at
 * BUILD time (so the SW is always verified by `next build`), but we do NOT
 * auto-register it: `register: false` means the SW is only ever registered at
 * runtime by `ServiceWorkerManager`, and only when the offline feature flag is
 * on (§59). With the flag off, the compiled SW just sits inert — the online-only
 * app is unchanged. Disabled entirely in dev to avoid caching friction while
 * iterating.
 */
const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  register: false,
  reloadOnOnline: false,
  disable: process.env.NODE_ENV === "development",
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /**
   * Self-hosted deployment (§VPS migration): `standalone` emits a
   * self-contained `.next/standalone` server with only the traced
   * dependencies, so the target host never needs pnpm, a workspace install,
   * or a build toolchain — it receives a built artifact and runs
   * `node server.js`. This matters because the server is a 2 GB box shared
   * with another product: `next build` there would thrash swap and could
   * disturb a live neighbour, so builds happen off-box and only the artifact
   * ships.
   *
   * `outputFileTracingRoot` is REQUIRED in a pnpm workspace. Dependency
   * tracing starts at the config's own directory by default, which in a
   * monorepo stops short of the hoisted root `node_modules` and silently
   * omits files the server needs at runtime (the failure appears only after
   * deploy, as a missing module). Pointing it at the repo root makes tracing
   * see the whole store. Next 14 still namespaces this under `experimental`.
   */
  output: "standalone",
  experimental: {
    outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  },
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
// Compose: Serwist wraps the base config (adds the SW build step), then Sentry
// wraps that (its instrumentation + RSC/route error wrapping). Verified to build
// together in a production `next build` (§ "Serwist + withSentryConfig work
// together").
export default withSentryConfig(withSerwist(nextConfig), {
  silent: true,
  telemetry: false,
  disableLogger: true,
  sourcemaps: { disable: true },
});
