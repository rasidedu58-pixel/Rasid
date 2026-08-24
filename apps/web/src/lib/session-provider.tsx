"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseClient, SupabaseConfigError } from "./supabase-client";
import { ConfigErrorScreen } from "../components/shell/config-error-screen";

interface SessionContextValue {
  session: Session | null;
  status: "loading" | "authenticated" | "unauthenticated" | "unconfigured";
}

const SessionContext = createContext<SessionContextValue>({ session: null, status: "loading" });

/**
 * Single source of truth for "is there a Supabase session right now" —
 * every authenticated layout/page reads this instead of each re-deriving
 * its own `supabase.auth.getSession()` effect (the pre-Phase-11 pattern
 * used ad hoc in `onboarding/page.tsx`).
 *
 * Deployment Closure Delta: this effect runs unconditionally on EVERY
 * route (mounted in the root layout, wraps public pages too) — it is the
 * exact call site that turned a missing `NEXT_PUBLIC_SUPABASE_*` env var
 * into a full-app crash in production (see `supabase-client.ts`'s own
 * comment for the full root-cause writeup). Catching `SupabaseConfigError`
 * here and exposing a distinct `"unconfigured"` status is what lets
 * `AuthGuard`/`ConfigErrorScreen` render an honest message instead of
 * the entire tree unmounting with Next's generic crash overlay.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<SessionContextValue["status"]>("loading");

  useEffect(() => {
    let supabase;
    try {
      supabase = getSupabaseClient();
    } catch (error) {
      if (error instanceof SupabaseConfigError) {
        setStatus("unconfigured");
        return;
      }
      throw error;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setStatus(data.session ? "authenticated" : "unauthenticated");
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setStatus(nextSession ? "authenticated" : "unauthenticated");
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  // Every route mounts under this provider, public pages included — a
  // missing config must be visible immediately, not just on protected
  // routes (login/signup would otherwise render fine visually but every
  // submit would fail with a confusing "تعذّر الاتصال بالخادم").
  if (status === "unconfigured") {
    return <ConfigErrorScreen />;
  }

  return <SessionContext.Provider value={{ session, status }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  return useContext(SessionContext);
}
