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

  DATABASE_URL: z.string().optional(),

  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  /** HS256 secret used to verify Supabase-issued access tokens server-side. */
  SUPABASE_JWT_SECRET: z.string().optional(),

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
