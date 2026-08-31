import { env } from "../../env";
import { getSupabaseClient } from "../supabase-client";

const LOCAL_DEV_API_URL = "http://localhost:3000/api/v1";

/**
 * Deployment Closure Delta: `NEXT_PUBLIC_API_URL` silently falling back to
 * `localhost:3000` was safe for local dev but a real, quiet failure mode
 * in production — a deployed browser calling `localhost` fails every
 * request with a generic network error and no hint that the ROOT cause is
 * a missing env var, not a real outage. The fallback now only applies
 * when the app itself is actually running on localhost (real local dev);
 * everywhere else, a missing `NEXT_PUBLIC_API_URL` throws immediately and
 * loudly instead of silently degrading into confusing per-request
 * failures.
 */
function apiBaseUrl(): string {
  if (env.NEXT_PUBLIC_API_URL) return env.NEXT_PUBLIC_API_URL;
  const isLocalHost = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  if (isLocalHost) return LOCAL_DEV_API_URL;
  throw new Error("NEXT_PUBLIC_API_URL is not configured for this deployment.");
}

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
  }
}

/** True for the specific, safe-no-leak/expected error shapes the UI should render as a dedicated state rather than a generic error toast. */
export function isForbidden(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && (error.status === 403 || error.code === "FORBIDDEN");
}
export function isNotFound(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && error.status === 404;
}
export function isEntitlementBlocked(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && error.code === "ENTITLEMENT_BLOCKED";
}
export function isValidationError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && error.code === "VALIDATION_ERROR";
}
export function isSessionExpired(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && (error.code === "SESSION_EXPIRED" || error.code === "UNAUTHENTICATED" || error.status === 401);
}

/**
 * Deployment Closure Delta — real bug found via live QA (`POST /groups`
 * 422 on an unfilled optional field): an uncontrolled `<input>` left
 * empty submits `""`, but nearly every optional string field across
 * `packages/contracts` is `z.string().trim().min(1).optional()` — which
 * accepts "absent" but rejects "present and empty". Rather than chase
 * this down at every one of the ~10 call sites across every form (and
 * every future one), it is normalized ONCE here: any top-level or
 * one-level-nested empty string in a request body becomes `undefined`
 * before serialization, matching what every one of those schemas already
 * expects for "not provided". Never touches arrays or already-non-empty
 * values.
 */
function stripEmptyOptionalStrings(value: unknown): unknown {
  if (Array.isArray(value) || value === null || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === "") {
      result[key] = undefined;
    } else if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      result[key] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, nested]) => [k, nested === "" ? undefined : nested]));
    } else {
      result[key] = v;
    }
  }
  return result;
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  workspaceId?: string;
  idempotencyKey?: string;
  /** Raw (non-JSON) response expected — used only by CSV export download. */
  raw?: boolean;
  query?: Record<string, string | number | boolean | undefined>;
}

function buildQueryString(query?: ApiRequestOptions["query"]): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/**
 * The single low-level entry point every domain api module goes through.
 * Reads the current Supabase access token itself (no caller ever passes
 * one manually — Phase 1's original `fetchMe`/`completeOnboarding`
 * required an explicit token argument; every OTHER endpoint added in
 * Phase 11 needs `X-Workspace-Id` too, so centralizing token+header
 * attachment here avoids repeating that at every call site). Redirects to
 * `/login?expired=1` on a real session-expiry signal rather than leaving
 * the caller to guess.
 */
export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const supabase = getSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    if (typeof window !== "undefined") window.location.assign("/login?expired=1");
    throw new ApiRequestError(401, "UNAUTHENTICATED", "لا توجد جلسة نشطة.");
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.access_token}`,
  };
  if (options.workspaceId) headers["X-Workspace-Id"] = options.workspaceId;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`${apiBaseUrl()}${path}${buildQueryString(options.query)}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(stripEmptyOptionalStrings(options.body)) : undefined,
  });

  if (options.raw) {
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new ApiRequestError(response.status, "UNKNOWN_ERROR", text || "Request failed.");
    }
    return (await response.text()) as unknown as T;
  }

  const body = (await response.json().catch(() => undefined)) as
    | T
    | { error?: { code?: string; message?: string; details?: Record<string, string[]> } }
    | undefined;

  if (!response.ok) {
    const errorBody = body as { error?: { code?: string; message?: string; details?: Record<string, string[]> } } | undefined;
    if (response.status === 401 && typeof window !== "undefined") {
      window.location.assign("/login?expired=1");
    }
    throw new ApiRequestError(
      response.status,
      errorBody?.error?.code ?? "UNKNOWN_ERROR",
      errorBody?.error?.message ?? "تعذّر تنفيذ الطلب.",
      errorBody?.error?.details,
    );
  }

  return body as T;
}

/**
 * Downloads a binary/file response (XLSX/PDF/CSV export) with the same auth as
 * apiRequest, returning the Blob plus the server-suggested filename (parsed
 * from `Content-Disposition: filename*=UTF-8''…`). Used for report exports; the
 * caller turns the Blob into a download.
 */
export async function apiDownload(path: string, options: { workspaceId?: string } = {}): Promise<{ blob: Blob; filename: string | null }> {
  const supabase = getSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    if (typeof window !== "undefined") window.location.assign("/login?expired=1");
    throw new ApiRequestError(401, "UNAUTHENTICATED", "لا توجد جلسة نشطة.");
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${session.access_token}` };
  if (options.workspaceId) headers["X-Workspace-Id"] = options.workspaceId;

  const response = await fetch(`${apiBaseUrl()}${path}`, { headers });
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") window.location.assign("/login?expired=1");
    const text = await response.text().catch(() => "");
    let code = "UNKNOWN_ERROR";
    let message = "تعذّر تنفيذ الطلب.";
    try {
      const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } };
      code = parsed.error?.code ?? code;
      message = parsed.error?.message ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiRequestError(response.status, code, message);
  }
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition) ?? /filename="?([^";]+)"?/i.exec(disposition);
  const filename = match ? decodeURIComponent(match[1]!) : null;
  return { blob: await response.blob(), filename };
}

/** A fresh idempotency key per mutation attempt (NOT per component render) — pass the SAME key across retries of the SAME logical attempt, a new one for a genuinely new attempt. */
export function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
