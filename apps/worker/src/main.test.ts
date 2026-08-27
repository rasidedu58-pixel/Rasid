import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Deployment Closure Delta — proves `bootstrap()` fails fast, synchronously,
 * with a clear message, and NEVER reaches the polling loop (so it never
 * attempts to claim/process an outbox event) when the worker's database
 * connection cannot be resolved (i.e. `WORKER_DATABASE_URL` is missing —
 * `getWorkerDb()` is exactly what throws in that case, see
 * packages/database/src/env.test.ts for the underlying no-fallback
 * guarantee this exercises at the entrypoint level).
 */
describe("worker bootstrap — fail-fast on missing app_worker connection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("exits with status 1 and never starts the polling loop when getWorkerDb() throws", async () => {
    const processedFn = vi.fn();
    vi.doMock("@academic-precision/database", () => ({
      getWorkerDb: () => {
        throw new Error(
          "WORKER_DATABASE_URL is not set. Configure it (the app_worker role's own connection string) " +
            "before starting the outbox dispatcher.",
        );
      },
      processPendingOutboxEvents: processedFn,
      closeDb: vi.fn(),
    }));
    vi.doMock("@academic-precision/observability", () => ({
      createLogger: () => ({ info: vi.fn(), debug: vi.fn(), error: vi.fn() }),
      runWithContext: (_ctx: unknown, fn: () => unknown) => fn(),
    }));

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__process_exit_${code}__`);
    }) as never);

    const { bootstrap } = await import("./main");

    expect(() => bootstrap()).toThrow("__process_exit_1__");
    expect(exitSpy).toHaveBeenCalledWith(1);
    // The polling loop (and therefore any outbox claim/process attempt)
    // must never run once getWorkerDb() has thrown.
    expect(processedFn).not.toHaveBeenCalled();
  });
});

/**
 * Phase 15D — the empty-poll backoff curve. Consecutive empty outbox polls
 * grow the idle delay 5s→10s→20s→30s (capped), cutting idle DB churn; the
 * first claimed event resets the streak to 0 (verified in runPollingLoop by
 * `emptyPollStreak = 0`), returning to the fast active cadence.
 */
describe("worker idle-poll backoff", () => {
  it("grows 5s → 10s → 20s → 30s and then stays capped at 30s", async () => {
    vi.doMock("@academic-precision/database", () => ({
      getWorkerDb: vi.fn(),
      processPendingOutboxEvents: vi.fn(),
      runSubscriptionExpiryCheck: vi.fn(),
      runNotificationsScan: vi.fn(),
      closeDb: vi.fn(),
    }));
    vi.doMock("@academic-precision/observability", () => ({
      createLogger: () => ({ info: vi.fn(), debug: vi.fn(), error: vi.fn() }),
      runWithContext: (_ctx: unknown, fn: () => unknown) => fn(),
    }));
    const { idlePollDelayMs } = await import("./main");
    expect(idlePollDelayMs(1)).toBe(5_000);
    expect(idlePollDelayMs(2)).toBe(10_000);
    expect(idlePollDelayMs(3)).toBe(20_000);
    expect(idlePollDelayMs(4)).toBe(30_000); // 40_000 clamped to the 30s cap
    expect(idlePollDelayMs(5)).toBe(30_000);
    expect(idlePollDelayMs(50)).toBe(30_000); // stays capped, never overflows
  });
});
