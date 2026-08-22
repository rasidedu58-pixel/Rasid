import { Inject, Injectable } from "@nestjs/common";
import jwt from "jsonwebtoken";
import { API_ENV } from "../../config/config.module";
import type { ServerEnv } from "@academic-precision/config/server";

/** Verified identity extracted from a Supabase-issued access token. */
export interface VerifiedSupabaseToken {
  id: string;
  email: string | null;
}

export interface TokenVerifier {
  verify(token: string): VerifiedSupabaseToken;
}

export const TOKEN_VERIFIER = Symbol("TOKEN_VERIFIER");

export class TokenExpiredVerificationError extends Error {}
export class InvalidTokenVerificationError extends Error {}

/**
 * Verifies Supabase-issued JWTs server-side using the project's JWT secret
 * (HS256) — Supabase's standard symmetric verification approach. The token
 * is never trusted client-side; verification happens exclusively here, and
 * the verified `sub` claim (never a client-supplied header/body field)
 * becomes the authoritative user id for the rest of the request.
 */
@Injectable()
export class JwtTokenVerifier implements TokenVerifier {
  constructor(@Inject(API_ENV) private readonly env: ServerEnv) {}

  verify(token: string): VerifiedSupabaseToken {
    const secret = this.env.SUPABASE_JWT_SECRET;
    if (!secret) {
      throw new InvalidTokenVerificationError("SUPABASE_JWT_SECRET is not configured.");
    }

    try {
      const payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
      if (typeof payload === "string") {
        throw new InvalidTokenVerificationError("Unexpected token payload shape.");
      }

      const sub = typeof payload.sub === "string" ? payload.sub : undefined;
      if (!sub) {
        throw new InvalidTokenVerificationError("Token payload missing sub claim.");
      }

      const email = typeof payload.email === "string" ? payload.email : null;
      return { id: sub, email };
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new TokenExpiredVerificationError("Token expired.");
      }
      if (error instanceof InvalidTokenVerificationError) {
        throw error;
      }
      throw new InvalidTokenVerificationError("Token verification failed.");
    }
  }
}
