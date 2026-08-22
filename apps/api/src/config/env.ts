import { loadServerEnv, type ServerEnv } from "@academic-precision/config/server";

/**
 * apps/api environment access point. Delegates schema/validation to the
 * shared config package. Every field is optional — build/lint/typecheck/test
 * never require real credentials; runtime code that needs a specific value
 * must assert its own presence.
 */
export function loadApiEnv(): ServerEnv {
  return loadServerEnv(process.env);
}
