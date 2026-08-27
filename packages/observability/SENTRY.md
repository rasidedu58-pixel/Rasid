# Sentry error tracking

Error tracking is **code-ready but DSN-gated**. The code ships with `@sentry/*`
declared as a dependency but is written so that:

- with **no DSN** it is a clean no-op (a single debug line, nothing sent);
- with **the package not yet installed** it still typechecks and builds, and
  degrades to a no-op at runtime instead of crashing;
- the moment a DSN env var is set **and** the package is installed, it
  activates — no code change required.

## Activating

1. Install the SDKs (not done automatically):

   ```bash
   pnpm add @sentry/node -F @academic-precision/api -F @academic-precision/worker
   pnpm add @sentry/nextjs -F @academic-precision/web
   ```

2. Set the DSN env vars in the relevant environments (see below).
3. Ensure each bootstrap calls the init function (server) / provider (web).

## Environment variables

### Server (apps/api, apps/worker) — `@academic-precision/observability`

| Variable                       | Required | Default                 | Meaning                                             |
| ------------------------------ | -------- | ----------------------- | --------------------------------------------------- |
| `SENTRY_DSN`                   | gate     | — (unset = disabled)    | Sentry DSN. **Unset ⇒ error tracking is off.**      |
| `SENTRY_ENVIRONMENT`           | no       | `NODE_ENV` or `development` | Sentry `environment` tag.                        |
| `SENTRY_RELEASE`               | no       | unset                   | Optional release/version string.                    |
| `SENTRY_TRACES_SAMPLE_RATE`    | no       | `0`                     | Performance tracing rate, `0`–`1`. Kept low.        |
| `OBSERVABILITY_DEBUG`          | no       | unset                   | `1` to print the one-line enable/disable debug log. |

`SENTRY_DSN` is already declared in `@academic-precision/config`'s server env
schema. The other vars are read directly from `process.env`.

### Web (apps/web) — `src/lib/error-tracking.ts`

| Variable                                 | Required | Default                    | Meaning                                    |
| ---------------------------------------- | -------- | -------------------------- | ------------------------------------------ |
| `NEXT_PUBLIC_SENTRY_DSN`                 | gate     | — (unset = disabled)       | Browser DSN. **Unset ⇒ off.**              |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT`         | no       | `NODE_ENV` or `development` | Sentry `environment` tag.                 |
| `NEXT_PUBLIC_SENTRY_RELEASE`             | no       | unset                      | Optional release string.                   |
| `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`  | no       | `0`                        | Performance tracing rate, `0`–`1`.         |

Browser DSNs must use the `NEXT_PUBLIC_` prefix so Next.js inlines them into
the client bundle.

## Wiring (call sites)

The observability package exposes:

- `initErrorTracking(serviceName: string): Promise<ErrorReporter>` — call once at
  process bootstrap.
- `captureException(error, extra?)` — capture anywhere; no-op until init runs.
- `flushErrorTracking(timeoutMs?)` — call before graceful shutdown.
- `errorReporter` — an `ErrorReporter` backed by the above.

The web helper (`apps/web/src/lib/error-tracking.ts`) exposes
`initErrorTracking()` and `captureException(error, extra?)`.

## What is protected

- **PII scrubbing.** A `beforeSend` hook runs every outgoing event through the
  same field list as `redactLogObject` (`redact.ts`): passwords, tokens, QR raw
  values, API keys, signatures, card numbers etc. are redacted; guardian
  phone-like values are masked. Request bodies/cookies/headers are dropped
  wholesale (only method + path kept).
- **Correlation context.** `requestId`, `jobId`, `userId`, `workspaceId` from the
  AsyncLocalStorage `getContext()` store are attached as tags and a
  `correlation` context on every event.
