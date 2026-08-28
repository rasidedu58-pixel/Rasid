/**
 * Phase 15G — controlled Sentry test-event sender for the Node runtimes
 * (api / worker). SAFE: it only ever sends ONE synthetic error, carries no
 * PII, and is a no-op unless `SENTRY_DSN` is set AND `@sentry/node` is
 * installed. This is the §16 proof path — run it against staging with a real
 * DSN and confirm the event appears in Sentry.
 *
 *   pnpm --filter @academic-precision/observability build   # once
 *   SENTRY_DSN=... SENTRY_ENVIRONMENT=staging \
 *     node packages/observability/scripts/send-test-event.mjs api
 *
 * The service arg (api | worker) sets the `service` tag so the event is
 * attributable in a shared Sentry project. Never wire this to a public HTTP
 * route — it stays a script.
 */
import { initErrorTracking, captureException, flushErrorTracking } from "../dist/index.js";

const service = process.argv[2] === "worker" ? "academic-precision-worker" : "academic-precision-api";
const stamp = process.env.TEST_EVENT_STAMP ?? "manual-run";

await initErrorTracking(service);
captureException(new Error(`[observability-test] controlled test event · ${service} · ${stamp}`), {
  test: true,
  service,
  note: "Phase 15G verification — no real error, no PII.",
});
await flushErrorTracking(5000);

if (process.env.SENTRY_DSN) {
  // eslint-disable-next-line no-console
  console.log(`[send-test-event] Flushed a test event for "${service}". If @sentry/node is installed, it is now in Sentry (env=${process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development"}).`);
} else {
  // eslint-disable-next-line no-console
  console.log(`[send-test-event] SENTRY_DSN is unset → no-op (nothing sent). Set SENTRY_DSN and install @sentry/node to deliver a real event.`);
}
