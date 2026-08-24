"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "../../lib/session-provider";

/**
 * Renders nothing — a tiny client island so an already-logged-in visitor
 * landing on `/` (or another public marketing page) is bounced to
 * `/dashboard` instead of seeing marketing copy again. A crawler/anonymous
 * visitor has no Supabase session, so this never affects what Google (or
 * anyone signed out) sees — the marketing page renders and is indexed
 * exactly as authored.
 */
export function AuthenticatedRedirect() {
  const router = useRouter();
  const { status } = useSession();

  useEffect(() => {
    if (status === "authenticated") router.replace("/dashboard");
  }, [status, router]);

  return null;
}
