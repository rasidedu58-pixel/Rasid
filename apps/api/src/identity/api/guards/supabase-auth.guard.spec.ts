import type { ExecutionContext } from "@nestjs/common";
import { SessionExpiredException, UnauthenticatedException } from "../../../common/exceptions/api.exception";
import {
  TokenExpiredVerificationError,
  InvalidTokenVerificationError,
  type TokenVerifier,
  type VerifiedSupabaseToken,
} from "../../infrastructure/jwt-token-verifier";
import { AUTH_USER_REQUEST_KEY, type AuthenticatedRequest, SupabaseAuthGuard } from "./supabase-auth.guard";

function makeContext(headers: Record<string, string | undefined>): {
  context: ExecutionContext;
  request: AuthenticatedRequest;
} {
  const request = { headers } as unknown as AuthenticatedRequest;
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe("SupabaseAuthGuard", () => {
  it("throws UNAUTHENTICATED (401) when there is no Authorization header — proves GET /me requires a session", () => {
    const verifier: TokenVerifier = { verify: jest.fn() };
    const guard = new SupabaseAuthGuard(verifier);
    const { context } = makeContext({});

    let caught: unknown;
    try {
      guard.canActivate(context);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(UnauthenticatedException);
    expect((caught as UnauthenticatedException).getStatus()).toBe(401);
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it("throws UNAUTHENTICATED (401) for a malformed/invalid token", () => {
    const verifier: TokenVerifier = {
      verify: jest.fn(() => {
        throw new InvalidTokenVerificationError("bad signature");
      }),
    };
    const guard = new SupabaseAuthGuard(verifier);
    const { context } = makeContext({ authorization: "Bearer not-a-real-token" });

    expect(() => guard.canActivate(context)).toThrow(UnauthenticatedException);
  });

  it("throws SESSION_EXPIRED (401) when the token verifier reports expiry", () => {
    const verifier: TokenVerifier = {
      verify: jest.fn(() => {
        throw new TokenExpiredVerificationError("expired");
      }),
    };
    const guard = new SupabaseAuthGuard(verifier);
    const { context } = makeContext({ authorization: "Bearer expired-token" });

    let caught: unknown;
    try {
      guard.canActivate(context);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SessionExpiredException);
  });

  it("attaches the verified user to the request and allows the route on a valid token", () => {
    const verified: VerifiedSupabaseToken = { id: "user-1", email: "a@b.com" };
    const verifier: TokenVerifier = { verify: jest.fn(() => verified) };
    const guard = new SupabaseAuthGuard(verifier);
    const { context, request } = makeContext({ authorization: "Bearer good-token" });

    const allowed = guard.canActivate(context);

    expect(allowed).toBe(true);
    expect(request[AUTH_USER_REQUEST_KEY]).toEqual(verified);
  });
});
