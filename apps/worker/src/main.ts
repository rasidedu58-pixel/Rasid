import { createLogger, runWithContext } from "@academic-precision/observability";
import { randomUUID } from "node:crypto";
import { registerGracefulShutdown } from "./shutdown";

/**
 * Standalone worker process bootstrap.
 *
 * Phase 0 foundation only: no real queue/job is registered yet (no session
 * generation, attention evaluation, billing, or reports). This proves the
 * process boots, logs with correlation context, and shuts down gracefully.
 * Later phases register BullMQ workers here using
 * `src/queue/connection.ts`'s `createRedisConnection()`.
 */
const logger = createLogger("academic-precision-worker");

function bootstrap(): void {
  const bootId = randomUUID();

  runWithContext({ jobId: bootId }, () => {
    logger.info({ bootId }, "Academic Precision worker starting (Phase 0 foundation).");
  });

  // Keeps the process alive as a long-running worker. Later phases replace
  // this with real BullMQ worker(s) consuming from the Redis connection
  // factory in src/queue/connection.ts.
  const heartbeat = setInterval(() => {
    logger.debug("Worker heartbeat — no queues registered in Phase 0.");
  }, 60_000);

  registerGracefulShutdown(logger, async () => {
    clearInterval(heartbeat);
    // No live connections/queues to close yet in Phase 0.
  });
}

bootstrap();
