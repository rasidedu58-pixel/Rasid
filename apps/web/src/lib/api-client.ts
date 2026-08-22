import type { MeResponse, OnboardingCompleteRequest, OnboardingCompleteResponse } from "@academic-precision/contracts";
import { env } from "../env";

const DEFAULT_API_URL = "http://localhost:3000/api/v1";

function apiBaseUrl(): string {
  return env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;
}

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function apiFetch<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...init?.headers,
    },
  });

  const body = (await response.json().catch(() => undefined)) as
    | T
    | { error?: { code?: string; message?: string } }
    | undefined;

  if (!response.ok) {
    const errorBody = body as { error?: { code?: string; message?: string } } | undefined;
    throw new ApiRequestError(
      response.status,
      errorBody?.error?.code ?? "UNKNOWN_ERROR",
      errorBody?.error?.message ?? "Request failed.",
    );
  }

  return body as T;
}

/** Never trusts any client-side workspace/user id — the backend derives them from the verified token. */
export function fetchMe(accessToken: string): Promise<MeResponse> {
  return apiFetch<MeResponse>("/me", accessToken, { method: "GET" });
}

export function completeOnboarding(
  accessToken: string,
  body: OnboardingCompleteRequest,
): Promise<OnboardingCompleteResponse> {
  return apiFetch<OnboardingCompleteResponse>("/onboarding/complete", accessToken, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
