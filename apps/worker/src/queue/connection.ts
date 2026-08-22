import IORedis, { type Redis } from "ioredis";
import { getRedisUrl } from "../config/env";

/**
 * Redis/BullMQ connection factory. This is an abstraction only — no real
 * queue/worker/job is registered against it in Phase 0. `getRedisUrl()` is
 * only invoked when `createRedisConnection()` is actually called, so
 * importing this module never requires a live Redis instance.
 */
export function createRedisConnection(): Redis {
  return new IORedis(getRedisUrl(), {
    // BullMQ requires this to be null so it can manage retries itself.
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });
}
