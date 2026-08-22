import { z } from "zod";

/**
 * Worker environment schema. `REDIS_URL` is optional at the schema level so
 * importing this module (and thus building/typechecking/linting/testing the
 * worker) never requires a live Redis instance. Runtime code that actually
 * connects must call `getRedisUrl()`, documented to require `REDIS_URL` at
 * runtime only.
 */
const workerEnvSchema = z.object({
  REDIS_URL: z.string().optional(),
  NODE_ENV: z.enum(["development", "staging", "production", "test"]).optional(),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function loadWorkerEnv(
  source: Record<string, string | undefined> = process.env,
): WorkerEnv {
  return workerEnvSchema.parse(source);
}

/**
 * Returns a validated Redis connection URL. Throws only when something
 * actually attempts to connect without `REDIS_URL` configured — never at
 * module import time.
 */
export function getRedisUrl(
  source: Record<string, string | undefined> = process.env,
): string {
  const { REDIS_URL } = loadWorkerEnv(source);
  if (!REDIS_URL) {
    throw new Error("REDIS_URL is not set. Configure it before connecting the worker to Redis.");
  }
  return REDIS_URL;
}
