"use client";

import { useEffect } from "react";
import { captureException } from "../lib/error-tracking";

/**
 * Deployment Closure Delta — defense-in-depth. Next.js's App Router only
 * catches errors thrown BELOW the root layout via `error.tsx` files; an
 * exception thrown by the root layout itself (or anything it mounts
 * unconditionally, like `SessionProvider` used to) bypasses those and
 * falls through to Next's own generic "Application error: a client-side
 * exception has occurred" overlay with zero detail. `global-error.tsx` is
 * the ONE boundary that also covers the root layout — it must render its
 * own `<html>`/`<body>` since it replaces the root layout when triggered.
 *
 * The actual production crash this session diagnosed (missing
 * `NEXT_PUBLIC_SUPABASE_*` env vars) is now handled specifically and
 * gracefully by `SessionProvider`/`ConfigErrorScreen` before it would ever
 * reach here — this boundary exists for any OTHER unforeseen exception,
 * so the app never again shows a bare, unexplained crash screen.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("Unhandled root-level error:", error);
    // §3 — forward the one boundary that also covers the root layout to
    // Sentry (no-op unless NEXT_PUBLIC_SENTRY_DSN is configured). The digest
    // correlates this client event with the matching server-side error.
    captureException(error, { digest: error.digest, boundary: "global-error" });
  }, [error]);

  return (
    <html lang="ar" dir="rtl">
      <body>
        <div style={{ display: "flex", minHeight: "100vh", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem", padding: "1.5rem", textAlign: "center", fontFamily: "system-ui, sans-serif" }}>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600 }}>حدث خطأ غير متوقع</h1>
          <p style={{ maxWidth: "28rem", color: "#475569", fontSize: "0.875rem" }}>
            تعذّر تحميل التطبيق. حاول إعادة المحاولة، وإذا تكرر الخطأ تواصل مع الدعم الفني.
          </p>
          <button
            onClick={reset}
            style={{ borderRadius: "0.375rem", backgroundColor: "#0f172a", color: "#fff", padding: "0.5rem 1.25rem", fontSize: "0.875rem", border: "none", cursor: "pointer" }}
          >
            إعادة المحاولة
          </button>
        </div>
      </body>
    </html>
  );
}
