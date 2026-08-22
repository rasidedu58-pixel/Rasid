export type ShutdownHandler = () => Promise<void> | void;

type MinimalLogger = {
  info: (obj: Record<string, unknown> | string, msg?: string) => void;
  error: (obj: Record<string, unknown> | string, msg?: string) => void;
};

/**
 * Registers SIGTERM/SIGINT handlers that run the given shutdown handler
 * once and then exit. Foundation-only: later phases pass real cleanup
 * (closing BullMQ workers/connections) once queues are registered.
 */
export function registerGracefulShutdown(logger: MinimalLogger, handler: ShutdownHandler): void {
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, "Received shutdown signal, closing worker gracefully.");
    try {
      await handler();
      logger.info("Worker shut down cleanly.");
      process.exit(0);
    } catch (error) {
      logger.error({ error }, "Error during worker shutdown.");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
