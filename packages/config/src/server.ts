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
  /** The single V1 subscription price id in Paddle's dashboard — checkout creation attaches it directly (no in-app plan picker in V1). */
  PADDLE_PRICE_ID: z.string().optional(),

  /**
   * Billing Phase 3 — MANUAL payment channel config (InstaPay / Vodafone Cash +
   * a WhatsApp number for payment-proof). These are display/config values, NOT
   * secrets like tokens — but kept central here (never hardcoded in components).
   * All optional: when unset, the customer billing UI shows a safe "payment
   * channel unavailable" state instead of crashing, and no payment-request
   * instructions are rendered.
   */
  RASID_INSTAPAY_HANDLE: z.string().optional(),
  RASID_VODAFONE_CASH_NUMBER: z.string().optional(),
  /** E.164-ish (digits, optional leading +) WhatsApp number Rasid receives payment proof on. */
  RASID_BILLING_WHATSAPP_NUMBER: z.string().optional(),

  SENTRY_DSN: z.string().optional(),
  POSTHOG_API_KEY: z.string().optional(),

  /**
   * Phase 10 — rate limiting (API Contract §18 Security Contract: "Rate
   * limit أعلى صرامة على Auth، QR resolve، search، invitation/webhook abuse
   * surfaces"). Every limit is environment-configurable rather than
   * hardcoded, per the Phase 10 correction: initial values are safe
   * defaults (applied in code when a var is unset — see
   * `apps/api/src/common/rate-limit/rate-limit.config.ts`), meant to be
   * revisited against real load-test results, not treated as final.
   * `ttlMs` = the sliding window length; `limit` = max requests per window
   * per client (IP, or IP+workspace where noted at the call site).
   */
  RATE_LIMIT_DEFAULT_LIMIT: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_DEFAULT_TTL_MS: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_SEARCH_LIMIT: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_SEARCH_TTL_MS: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_QR_LIMIT: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_QR_TTL_MS: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_BILLING_LIMIT: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_BILLING_TTL_MS: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_EXPORT_LIMIT: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_EXPORT_TTL_MS: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_WEBHOOK_LIMIT: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_WEBHOOK_TTL_MS: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_PLATFORM_ADMIN_LIMIT: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_PLATFORM_ADMIN_TTL_MS: z.coerce.number().int().positive().optional(),

  /**
   * Phase 11 — comma-separated list of allowed browser origins for CORS
   * (e.g. `https://app.rasid.example,http://localhost:3001`). Required for
   * apps/web (a distinct origin — Vercel — from apps/api's Railway host) to
   * call the API at all; the API previously had no CORS configuration,
   * which silently blocks every cross-origin browser request. Unset in
   * local/test — apps/api falls back to a safe localhost-only default (see
   * main.ts), never to "allow everything".
   */
  CORS_ALLOWED_ORIGINS: z.string().optional(),
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
