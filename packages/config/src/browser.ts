import { z } from "zod";

/**
 * Browser-safe configuration schema.
 *
 * Only `NEXT_PUBLIC_*` (or otherwise safe-to-expose) values belong here.
 * Nothing in this module may hold a secret. All values are optional with
 * safe defaults so build/lint/typecheck never require real credentials.
 */
const browserEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_HOST: z.string().optional(),
});

export type BrowserEnv = z.infer<typeof browserEnvSchema>;

/**
 * Parses browser-safe environment variables from an arbitrary source
 * (defaults to `process.env` when available). Never throws on missing
 * values — every field is optional so this is safe to call during
 * build/lint/typecheck without real credentials configured.
 */
export function loadBrowserEnv(
  source: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): BrowserEnv {
  return browserEnvSchema.parse(source);
}
