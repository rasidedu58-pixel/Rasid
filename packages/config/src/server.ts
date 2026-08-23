import { z } from "zod";

/**
 * Server-only configuration schema.
 *
 * Contains variable NAMES/shape only — no defaults leak real secrets, and
 * every field is optional so build/lint/typecheck/test never require live
 * credentials. Runtime code that actually needs a value must validate its
 * own presence explicitly (see packages/database, apps/api, apps/worker).
 *
 * This module must never be imported from browser/client bundles.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "staging", "production", "test"]).optional(),
  PORT: z.coerce.number().int().positive().optional(),

  /**
   * Runtime application connection string, using the least-privilege
   * `app_runtime` Postgres role (NOBYPASSRLS) — used by apps/api at request
   * time. See packages/database's RLS Security Delta migration
   * (0006_runtime_role_least_privilege.sql).
   */
  DATABASE_URL: z.string().optional(),
  /**
   * Privileged connection string (table-owning `postgres` role) used ONLY
   * for running migrations (`pnpm db:migrate` / `drizzle-kit generate`) —
   * never used by request-serving application code.
   */
  MIGRATION_DATABASE_URL: z.string().optional(),

  /**
   * Base Supabase project URL. Also used server-side to derive the JWKS
   * endpoint (`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`) and expected
   * issuer (`{SUPABASE_URL}/auth/v1`) for asymmetric access-token
   * verification — no shared HS256 secret is used in production.
   */
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  REDIS_URL: z.string().optional(),

  RESEND_API_KEY: z.string().optional(),

  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_ENDPOINT: z.string().optional(),

  PADDLE_API_KEY: z.string().optional(),
  PADDLE_WEBHOOK_SECRET: z.string().optional(),
  PADDLE_ENVIRONMENT: z.string().optional(),

  SENTRY_DSN: z.string().optional(),
  POSTHOG_API_KEY: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Parses server-only environment variables from an arbitrary source
 * (defaults to `process.env`). Never throws on missing values by itself —
 * callers that require a specific variable at runtime must assert its
 * presence explicitly rather than relying on this loader to fail.
 */
export function loadServerEnv(
  source: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): ServerEnv {
  return serverEnvSchema.parse(source);
}
