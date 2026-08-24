import { env } from "../../env";
import { getSupabaseClient } from "../supabase-client";

const DEFAULT_API_URL = "http://localhost:3000/api/v1";

function apiBaseUrl(): string {
  return env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;
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
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
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

/** A fresh idempotency key per mutation attempt (NOT per component render) — pass the SAME key across retries of the SAME logical attempt, a new one for a genuinely new attempt. */
export function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
