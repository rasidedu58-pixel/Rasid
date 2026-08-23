import { createLogger, runWithContext } from "@academic-precision/observability";
import { randomUUID } from "node:crypto";
import { closeDb, getWorkerDb, processPendingOutboxEvents } from "@academic-precision/database";
import { registerGracefulShutdown } from "./shutdown";

/**
 * Standalone worker process bootstrap — Phase 7.
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
 */
const logger = createLogger("academic-precision-worker");

const POLL_EVENT_TYPES = ["SessionCompleted"];
const IDLE_POLL_DELAY_MS = 5_000; // nothing was claimed — wait a bit before checking again.
const ACTIVE_POLL_DELAY_MS = 250; // something WAS claimed — check again soon, more may be waiting.
const ERROR_POLL_DELAY_MS = 15_000; // an unexpected (non-event-scoped) error — back off harder.
const MAX_EVENTS_PER_CYCLE = 20;

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
  while (!state.stopped) {
    const bootId = randomUUID();
    try {
      const result = await runWithContext({ jobId: bootId }, () =>
        processPendingOutboxEvents(workerDb, { eventTypes: POLL_EVENT_TYPES, maxEvents: MAX_EVENTS_PER_CYCLE }),
      );

      if (result.claimed === 0) {
        await sleep(IDLE_POLL_DELAY_MS, state);
      } else {
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
    await closeDb();
  });
}

export { bootstrap, runPollingLoop };

// `require.main === module` (CommonJS — this package compiles to CommonJS,
// see tsconfig.json) guards the real process bootstrap so this module can
// be safely `import`ed from a test (see `main.test.ts`) without it
// auto-connecting to a database or calling `process.exit`.
if (require.main === module) {
  bootstrap();
}
