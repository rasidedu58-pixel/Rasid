"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../env";

/**
 * Browser-only Supabase Auth client. Uses ONLY the public URL + anon key —
 * never the service_role key, which must never reach apps/web. This client
 * is the sole place Supabase Auth is called from; all workspace/membership
 * business data is read through the NestJS API, never directly from
 * Supabase-managed Postgres.
 */
let client: SupabaseClient | undefined;

/**
 * Deployment Closure Delta — the actual production crash root cause:
 * `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` were unset in
 * the Vercel Production environment, so this threw synchronously; the ONE
 * caller that matters most (`SessionProvider`, mounted in the root layout
 * on EVERY route including /login) called it unconditionally inside a
 * `useEffect` with no surrounding try/catch and no error boundary above
 * it — so the whole app tree unmounted, producing Next's generic
 * "Application error: a client-side exception has occurred" with zero
 * hint at the real cause. `SupabaseConfigError` is a distinct type so
 * callers (`SessionProvider` especially) can render a clear, honest
 * "not configured" state instead of crashing — see
 * `session-provider.tsx` and `app/global-error.tsx`.
 */
export class SupabaseConfigError extends Error {
  constructor() {
    super("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not configured.");
    this.name = "SupabaseConfigError";
  }
}

export function isSupabaseConfigured(): boolean {
  return !!env.NEXT_PUBLIC_SUPABASE_URL && !!env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

export function getSupabaseClient(): SupabaseClient {
  if (!client) {
    const url = env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      throw new SupabaseConfigError();
    }
    client = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}
