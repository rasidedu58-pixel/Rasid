/**
 * Phase 15G — controlled Sentry test-event sender for the Node runtimes
 * (api / worker). SAFE: sends ONE synthetic error, carries no PII, and only
 * ever does anything when `SENTRY_DSN` is set AND `@sentry/node` is installed.
 *
 *   pnpm --filter @academic-precision/api add @sentry/node   # + worker
 *   pnpm --filter @academic-precision/observability build
 *   SENTRY_DSN=... SENTRY_ENVIRONMENT=staging \
 *     node packages/observability/scripts/send-test-event.mjs api
 *
 * Exit code is HONEST proof, not a formality:
 *   0  → SDK was genuinely ACTIVE and Sentry returned an event id that
 *        flushed to the ingest endpoint within the timeout.
 *   1  → SDK NOT active (DSN unset or @sentry/node absent) — nothing sent.
 *   2  → SDK active but delivery could not be confirmed (no id / flush timeout).
 * A `0` therefore cannot happen on a no-op path — the exact false-positive
 * this verification must avoid.
 */
import { initErrorTracking, captureException, flushErrorTracking, isErrorTrackingActive } from "../dist/index.js";

const service = process.argv[2] === "worker" ? "academic-precision-worker" : "academic-precision-api";
const stamp = process.env.TEST_EVENT_STAMP ?? new Date().toISOString();
const environment = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development";
const message = `[observability-test] controlled test event · ${service} · ${environment} · ${stamp}`;

await initErrorTracking(service);

if (!isErrorTrackingActive()) {
  // eslint-disable-next-line no-console
  console.error(
    `[send-test-event] ✗ FAIL — Sentry SDK is NOT active (SENTRY_DSN unset or @sentry/node not installed). NO event was sent.`,
  );
  process.exit(1);
}

const eventId = captureException(new Error(message), {
  test: true,
  service,
  note: "Phase 15G verification — synthetic error, no real error, no PII.",
});
const flushed = await flushErrorTracking(8000);

if (eventId && flushed) {
  // eslint-disable-next-line no-console
  console.log(
    `[send-test-event] ✓ SENT — SDK active, event accepted and flushed to Sentry.\n` +
      `  environment: ${environment}\n  service tag: ${service}\n  event id:    ${eventId}\n  message:     ${message}`,
  );
  process.exit(0);
}

// eslint-disable-next-line no-console
console.error(
  `[send-test-event] ✗ UNCONFIRMED — SDK active but delivery not confirmed (eventId=${eventId ?? "none"}, flushed=${flushed}). Do NOT treat as sent.`,
);
process.exit(2);
