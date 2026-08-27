import { createLogger, runWithContext, initErrorTracking, flushErrorTracking } from "@academic-precision/observability";
import { randomUUID } from "node:crypto";
import { closeDb, getWorkerDb, processPendingOutboxEvents, runSubscriptionExpiryCheck, runNotificationsScan } from "@academic-precision/database";
import { registerGracefulShutdown } from "./shutdown";

/**
 * Standalone worker process bootstrap — Phase 7, extended in Phase 8.
 *
 * Runs the outbox dispatcher (packages/database/src/worker/outbox-
 * dispatcher.ts) on the dedicated, least-privilege `app_worker` connection
 * (never `app_runtime`, never the migration/admin role — see migrations/
 * 0032_app_worker_role.sql). Deliberately a SEQUENTIAL await-based polling
 * loop, NOT `setInterval`: `setInterval` would let a slow poll cycle
 * overlap with the next tick, letting two cycles race to claim/process
 * events concurrently on the SAME process — the explicit product
 * requirement is a serial loop where each cycle fully awaits the previous
 * one before scheduling the next, with backoff on empty/errored cycles and
 * a graceful-shutdown path that lets an in-flight cycle finish before the
 * process exits.
 *
 * Phase 8 adds the scheduled Subscription expiry check (API Contract §16)
 * on the SAME loop/connection — see `SUBSCRIPTION_EXPIRY_INTERVAL_MS` for
 * why it runs on its own coarser cadence rather than every cycle.
 */
const logger = createLogger("academic-precision-worker");

const POLL_EVENT_TYPES = ["SessionCompleted"];
const IDLE_POLL_DELAY_MS = 5_000; // first empty poll — wait a bit before checking again.
// Phase 15D — progressive backoff on CONSECUTIVE empty polls. The idle
// outbox claim (`SELECT ... FOR UPDATE SKIP LOCKED`) is a real transaction on
// every cycle; at a fixed 5s it was ~12 tx/min of pure idle DB churn (the
// dominant background contributor, and the source of the xact_commit
// contamination seen during read-path measurement). Growing the delay
// 5s→10s→20s→30s while nothing is claimed cuts steady-state idle churn to
// ~2 tx/min. The FIRST claimed event immediately resets to the fast active
// cadence, so once work arrives dispatch latency is unchanged; the only cost
// is that the first event after a long quiet stretch can wait up to the cap
// (30s) — acceptable for the attention/notification generation this drives
// (a day/hour-granularity concern, never user-blocking). The module's serial
// loop and the subscription/notification interval checks are unaffected (they
// gate on elapsed wall-clock, which a longer sleep only makes coarser within
// their own 60s/300s tolerances).
const IDLE_POLL_MAX_DELAY_MS = 30_000;
const ACTIVE_POLL_DELAY_MS = 250; // something WAS claimed — check again soon, more may be waiting.
const ERROR_POLL_DELAY_MS = 15_000; // an unexpected (non-event-scoped) error — back off harder.
const MAX_EVENTS_PER_CYCLE = 20;

/** Empty-poll backoff: 5s, 10s, 20s, then capped at 30s. `emptyStreak` is the count of consecutive empty polls so far (1 for the first). */
function idlePollDelayMs(emptyStreak: number): number {
  const delay = IDLE_POLL_DELAY_MS * 2 ** (emptyStreak - 1);
  return Math.min(delay, IDLE_POLL_MAX_DELAY_MS);
}

// Phase 8 — Subscription expiry is a day-granularity concern (`period_end`),
// not a sub-second one like outbox dispatch — running it on every ~250ms
// active-outbox cycle would be pure waste. Piggybacks on the SAME
// sequential polling loop (never a separate `setInterval`, for the exact
// overlapping-cycle reason explained in the module doc comment above) but
// only actually queries when this interval has elapsed since its last run.
const SUBSCRIPTION_EXPIRY_INTERVAL_MS = 60_000;

// Phase 9 — same coarse-cadence reasoning as subscription expiry above:
// notification generation (subscription reminders/follow-up due/missing
// records) is never a sub-second concern.
const NOTIFICATIONS_SCAN_INTERVAL_MS = 300_000; // 5 minutes

function sleep(ms: number, signal: { stopped: boolean }): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // Best-effort early wake-up on shutdown so the loop can exit promptly
    // rather than waiting out the full delay.
    const check = setInterval(() => {
      if (signal.stopped) {
        clearTimeout(timer);
        clearInterval(check);
        resolve();
      }
    }, 100);
    timer.unref?.();
    check.unref?.();
  });
}

async function runPollingLoop(state: { stopped: boolean }, workerDb: ReturnType<typeof getWorkerDb>): Promise<void> {
  let lastSubscriptionExpiryCheckAt = 0;
  let lastNotificationsScanAt = 0;
  let emptyPollStreak = 0;

  while (!state.stopped) {
    const bootId = randomUUID();
    try {
      const result = await runWithContext({ jobId: bootId }, () =>
        processPendingOutboxEvents(workerDb, { eventTypes: POLL_EVENT_TYPES, maxEvents: MAX_EVENTS_PER_CYCLE }),
      );

      if (Date.now() - lastSubscriptionExpiryCheckAt >= SUBSCRIPTION_EXPIRY_INTERVAL_MS) {
        lastSubscriptionExpiryCheckAt = Date.now();
        try {
          const expiryResult = await runWithContext({ jobId: bootId }, () => runSubscriptionExpiryCheck(workerDb));
          if (expiryResult.expired > 0 || expiryResult.conflicted > 0) {
            logger.info({ ...expiryResult }, "Subscription expiry scan completed.");
          }
        } catch (error) {
          // Deliberately scoped to THIS check only — a failure here must
          // never take down outbox dispatch, which already succeeded above.
          logger.error({ error }, "Subscription expiry scan failed unexpectedly — will retry next interval.");
        }
      }

      if (Date.now() - lastNotificationsScanAt >= NOTIFICATIONS_SCAN_INTERVAL_MS) {
        lastNotificationsScanAt = Date.now();
        try {
          const notificationsResult = await runWithContext({ jobId: bootId }, () => runNotificationsScan(workerDb));
          if (notificationsResult.subscriptionCreated > 0 || notificationsResult.followupCreated > 0 || notificationsResult.missingRecordsCreated > 0) {
            logger.info({ ...notificationsResult }, "Notifications scan completed.");
          }
        } catch (error) {
          // Same isolation rationale as the subscription-expiry check above.
          logger.error({ error }, "Notifications scan failed unexpectedly — will retry next interval.");
        }
      }

      if (result.dead > 0) {
        // Phase 10 — a permanently-invalid event just went terminal. Never
        // silent: this is the operator signal to inspect
        // `SELECT * FROM outbox_events WHERE status = 'DEAD'` and, once the
        // root cause is understood, replay it via `replayDeadOutboxEvent`.
        logger.error({ ...result }, "Outbox event(s) exhausted retries and are now DEAD — operator investigation required.");
      }

      if (result.claimed === 0) {
        emptyPollStreak += 1;
        await sleep(idlePollDelayMs(emptyPollStreak), state);
      } else {
        emptyPollStreak = 0; // work arrived — return to the fast active cadence immediately.
        logger.info({ ...result }, "Outbox dispatch cycle completed.");
        await sleep(ACTIVE_POLL_DELAY_MS, state);
      }
    } catch (error) {
      logger.error({ error }, "Outbox dispatch cycle failed unexpectedly — backing off.");
      await sleep(ERROR_POLL_DELAY_MS, state);
    }
  }
}

function bootstrap(): void {
  const bootId = randomUUID();
  const state = { stopped: false };

  runWithContext({ jobId: bootId }, () => {
    logger.info({ bootId }, "Academic Precision worker starting (Phase 7 — outbox dispatcher).");
  });

  // Phase 15D.1 — error tracking (no-op unless SENTRY_DSN is set). Fire-and-
  // forget: never block worker startup on the tracker's async init.
  void initErrorTracking("academic-precision-worker");

  // Resolved SYNCHRONOUSLY, before any connection opens or the polling loop
  // starts — `getWorkerDb()` throws immediately (via `getWorkerDatabaseUrl()`)
  // if `WORKER_DATABASE_URL` is unset. Deliberately NOT called from inside
  // `runPollingLoop` (an async function): a throw there would surface as an
  // unhandled promise rejection with a generic stack trace instead of a
  // clean, explicit fail-fast. There is no fallback to `DATABASE_URL`
  // (app_runtime's narrower, wrong-shaped grants) or `MIGRATION_DATABASE_URL`
  // (the privileged/BYPASSRLS role) — either would silently run the worker
  // under the wrong identity instead of failing loudly.
  let workerDb: ReturnType<typeof getWorkerDb>;
  try {
    workerDb = getWorkerDb();
  } catch (error) {
    logger.error(
      { error },
      "FATAL: WORKER_DATABASE_URL is not configured (or invalid). The worker requires its own " +
        "dedicated app_worker connection — see packages/database/src/migrations/README.md's " +
        "'Three connection strings' section for provisioning steps. Refusing to start; will NOT " +
        "fall back to DATABASE_URL or MIGRATION_DATABASE_URL.",
    );
    process.exit(1);
  }

  const loopPromise = runPollingLoop(state, workerDb);

  registerGracefulShutdown(logger, async () => {
    state.stopped = true;
    // Let the in-flight poll cycle (if any) finish its current
    // claim+process transaction before closing the connection — never cut
    // a transaction off mid-flight.
    await loopPromise;
    await flushErrorTracking();
    await closeDb();
  });
}

export { bootstrap, runPollingLoop, idlePollDelayMs };

// `require.main === module` (CommonJS — this package compiles to CommonJS,
// see tsconfig.json) guards the real process bootstrap so this module can
// be safely `import`ed from a test (see `main.test.ts`) without it
// auto-connecting to a database or calling `process.exit`.
if (require.main === module) {
  bootstrap();
}
