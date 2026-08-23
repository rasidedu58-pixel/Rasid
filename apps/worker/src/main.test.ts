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
