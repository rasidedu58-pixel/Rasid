import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/supabase-client", () => ({
  getSupabaseClient: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
    },
  }),
}));

describe("apiRequest", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "window",
      Object.assign(Object.create(window), { location: { assign: vi.fn() } }),
    );
  });

  it("redirects to /login?expired=1 and rejects when there is no active session (never sends a request without a token)", async () => {
    const { apiRequest, ApiRequestError } = await import("../lib/api/client");
    await expect(apiRequest("/students")).rejects.toBeInstanceOf(ApiRequestError);
    expect(window.location.assign).toHaveBeenCalledWith("/login?expired=1");
  });
});

describe("error classification helpers", () => {
  it("classify ApiRequestError instances by status/code, and never misclassify a plain Error", async () => {
    const { ApiRequestError, isForbidden, isNotFound, isEntitlementBlocked, isValidationError, isSessionExpired } = await import("../lib/api/client");

    expect(isForbidden(new ApiRequestError(403, "FORBIDDEN", "x"))).toBe(true);
    expect(isNotFound(new ApiRequestError(404, "RESOURCE_NOT_FOUND", "x"))).toBe(true);
    expect(isEntitlementBlocked(new ApiRequestError(403, "ENTITLEMENT_BLOCKED", "x"))).toBe(true);
    expect(isValidationError(new ApiRequestError(422, "VALIDATION_ERROR", "x"))).toBe(true);
    expect(isSessionExpired(new ApiRequestError(401, "UNAUTHENTICATED", "x"))).toBe(true);

    const plain = new Error("not an api error");
    expect(isForbidden(plain)).toBe(false);
    expect(isNotFound(plain)).toBe(false);
    expect(isEntitlementBlocked(plain)).toBe(false);
  });
});
