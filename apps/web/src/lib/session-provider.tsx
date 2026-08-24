"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseClient } from "./supabase-client";

interface SessionContextValue {
  session: Session | null;
  status: "loading" | "authenticated" | "unauthenticated";
}

const SessionContext = createContext<SessionContextValue>({ session: null, status: "loading" });

/**
 * Single source of truth for "is there a Supabase session right now" —
 * every authenticated layout/page reads this instead of each re-deriving
 * its own `supabase.auth.getSession()` effect (the pre-Phase-11 pattern
 * used ad hoc in `onboarding/page.tsx`).
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<SessionContextValue["status"]>("loading");

  useEffect(() => {
    const supabase = getSupabaseClient();
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

  return <SessionContext.Provider value={{ session, status }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  return useContext(SessionContext);
}
