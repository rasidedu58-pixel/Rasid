import { loadServerEnv } from "@academic-precision/config";

/**
 * Phase 10 — rate limiting defaults. Every number here is a SAFE STARTING
 * POINT, not a final production value (Phase 10 correction: "لا تخترع
 * arbitrary production limits وتُسميها نهائية"). Each is overridable via
 * env var (see `packages/config/src/server.ts`) so load-test results can
 * tune them per environment without a code change/redeploy.
 *
 * Named tiers, mirroring API Contract §18's own list of abuse surfaces:
 * - `default`: every other authenticated route (attendance batches, session
 *   workflows, payments, etc.) — generous, sized to never block legitimate
 *   burst usage (e.g. a teacher recording attendance for a 30-student
 *   group in one sitting).
 * - `search`: `GET /students` (name/code/guardian-phone search).
 * - `qr`: `POST /qr/resolve`.
 * - `billing`: `POST /billing/checkout`, `POST /billing/portal`.
 * - `export`: `POST /reports/export`, `GET /exports/:id`, `GET /exports/:id/download`.
 * - `webhook`: `POST /webhooks/paddle` — defense-in-depth ONLY; Paddle
 *   signature verification + idempotency (BillingService.handlePaddleWebhook)
 *   remain the authoritative defense, never this limit alone.
 */
export interface RateLimitTierConfig {
  limit: number;
  ttlMs: number;
}

export interface RateLimitConfig {
  default: RateLimitTierConfig;
  search: RateLimitTierConfig;
  qr: RateLimitTierConfig;
  billing: RateLimitTierConfig;
  export: RateLimitTierConfig;
  webhook: RateLimitTierConfig;
  /** Phase 12 — Platform Admin routes: a small, known set of privileged callers, tighter than `default`. */
  platformAdmin: RateLimitTierConfig;
}

const SAFE_DEFAULTS: RateLimitConfig = {
  // 300 req/min per client — well above any realistic single-teacher
  // workflow burst (attendance/homework batch endpoints are ONE request
  // per whole-class action, never per-student).
  default: { limit: 300, ttlMs: 60_000 },
  // Student search is typed-ahead — allow a generous per-minute budget
  // without permitting a full-directory scraping loop.
  search: { limit: 60, ttlMs: 60_000 },
  qr: { limit: 30, ttlMs: 60_000 },
  billing: { limit: 10, ttlMs: 60_000 },
  export: { limit: 10, ttlMs: 60_000 },
  // Paddle can legitimately burst-deliver retries; generous, and NOT the
  // primary defense (signature + idempotency are) — see module doc comment.
  webhook: { limit: 120, ttlMs: 60_000 },
  // Generous per-minute budget for legitimate dashboard/list/search
  // browsing by the (very small) set of platform admins, well below what a
  // scraping loop across every tenant would need.
  platformAdmin: { limit: 120, ttlMs: 60_000 },
};

export function loadRateLimitConfig(): RateLimitConfig {
  const env = loadServerEnv();
  return {
    default: {
      limit: env.RATE_LIMIT_DEFAULT_LIMIT ?? SAFE_DEFAULTS.default.limit,
      ttlMs: env.RATE_LIMIT_DEFAULT_TTL_MS ?? SAFE_DEFAULTS.default.ttlMs,
    },
    search: {
      limit: env.RATE_LIMIT_SEARCH_LIMIT ?? SAFE_DEFAULTS.search.limit,
      ttlMs: env.RATE_LIMIT_SEARCH_TTL_MS ?? SAFE_DEFAULTS.search.ttlMs,
    },
    qr: {
      limit: env.RATE_LIMIT_QR_LIMIT ?? SAFE_DEFAULTS.qr.limit,
      ttlMs: env.RATE_LIMIT_QR_TTL_MS ?? SAFE_DEFAULTS.qr.ttlMs,
    },
    billing: {
      limit: env.RATE_LIMIT_BILLING_LIMIT ?? SAFE_DEFAULTS.billing.limit,
      ttlMs: env.RATE_LIMIT_BILLING_TTL_MS ?? SAFE_DEFAULTS.billing.ttlMs,
    },
    export: {
      limit: env.RATE_LIMIT_EXPORT_LIMIT ?? SAFE_DEFAULTS.export.limit,
      ttlMs: env.RATE_LIMIT_EXPORT_TTL_MS ?? SAFE_DEFAULTS.export.ttlMs,
    },
    webhook: {
      limit: env.RATE_LIMIT_WEBHOOK_LIMIT ?? SAFE_DEFAULTS.webhook.limit,
      ttlMs: env.RATE_LIMIT_WEBHOOK_TTL_MS ?? SAFE_DEFAULTS.webhook.ttlMs,
    },
    platformAdmin: {
      limit: env.RATE_LIMIT_PLATFORM_ADMIN_LIMIT ?? SAFE_DEFAULTS.platformAdmin.limit,
      ttlMs: env.RATE_LIMIT_PLATFORM_ADMIN_TTL_MS ?? SAFE_DEFAULTS.platformAdmin.ttlMs,
    },
  };
}
