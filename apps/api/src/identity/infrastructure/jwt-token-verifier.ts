import { Inject, Injectable, Optional } from "@nestjs/common";
import { createRemoteJWKSet, jwtVerify, errors as joseErrors, type JWTVerifyGetKey } from "jose";
import { API_ENV } from "../../config/config.module";
import type { ServerEnv } from "@academic-precision/config/server";

/** Verified identity extracted from a Supabase-issued access token. */
export interface VerifiedSupabaseToken {
  id: string;
  email: string | null;
}

export interface TokenVerifier {
  verify(token: string): Promise<VerifiedSupabaseToken>;
}

export const TOKEN_VERIFIER = Symbol("TOKEN_VERIFIER");

export class TokenExpiredVerificationError extends Error {}
export class InvalidTokenVerificationError extends Error {}

const JWKS_PATH = "/auth/v1/.well-known/jwks.json";
const ISSUER_PATH = "/auth/v1";

/**
 * Verifies Supabase-issued access tokens server-side using Supabase's
 * asymmetric JWKS endpoint (`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`)
 * — Supabase's recommended production verification mechanism, not a shared
 * HS256 secret (see ADR-008: Supabase Auth proves identity only; no
 * client-supplied value is ever trusted).
 *
 * `jose`'s `createRemoteJWKSet` handles:
 * - key selection by the token's `kid` header,
 * - fetching + caching the JWKS document,
 * - automatic re-fetch/rotation when an unknown `kid` is encountered
 *   (rate-limited internally to avoid hammering the endpoint on abuse),
 * so key rotation on Supabase's side needs no secret rollout or restart
 * here.
 *
 * No hand-rolled cryptography: signature verification, claim validation
 * (`iss`, `exp`) and key resolution are entirely delegated to `jose`.
 */
@Injectable()
export class JwtTokenVerifier implements TokenVerifier {
  private jwks: JWTVerifyGetKey | undefined;
  private issuer: string | undefined;

  /**
   * `jwksOverride`/`issuerOverride` exist purely for tests: production code
   * always goes through the lazily-created remote JWKS resolver below, but
   * unit tests inject a local, in-memory JWKS (see jwt-token-verifier.spec.ts)
   * so verification is exercised without any network access.
   */
  constructor(
    @Inject(API_ENV) private readonly env: ServerEnv,
    @Optional() private readonly jwksOverride?: JWTVerifyGetKey,
    @Optional() private readonly issuerOverride?: string,
  ) {}

  async verify(token: string): Promise<VerifiedSupabaseToken> {
    const { jwks, issuer } = this.getVerificationContext();

    try {
      const { payload } = await jwtVerify(token, jwks, { issuer });

      const sub = typeof payload.sub === "string" ? payload.sub : undefined;
      if (!sub) {
        throw new InvalidTokenVerificationError("Token payload missing sub claim.");
      }

      const email = typeof payload.email === "string" ? payload.email : null;
      return { id: sub, email };
    } catch (error) {
      if (error instanceof joseErrors.JWTExpired) {
        throw new TokenExpiredVerificationError("Token expired.");
      }
      if (error instanceof InvalidTokenVerificationError) {
        throw error;
      }
      // Covers: JWTClaimValidationFailed (wrong issuer/audience), JWSSignatureVerificationFailed
      // (invalid signature), JWKSNoMatchingKey (unknown/rotated kid), JWSInvalid, malformed
      // tokens, and any other verification failure — all map to the same safe generic error.
      throw new InvalidTokenVerificationError("Token verification failed.");
    }
  }

  /** Lazily builds (and caches for the lifetime of this instance) the remote JWKS resolver. */
  private getVerificationContext(): { jwks: JWTVerifyGetKey; issuer: string } {
    if (this.jwksOverride && this.issuerOverride) {
      return { jwks: this.jwksOverride, issuer: this.issuerOverride };
    }

    if (!this.jwks || !this.issuer) {
      const supabaseUrl = this.env.SUPABASE_URL;
      if (!supabaseUrl) {
        throw new InvalidTokenVerificationError("SUPABASE_URL is not configured.");
      }
      const baseUrl = supabaseUrl.replace(/\/+$/, "");
      this.jwks = createRemoteJWKSet(new URL(`${baseUrl}${JWKS_PATH}`));
      this.issuer = `${baseUrl}${ISSUER_PATH}`;
    }
    return { jwks: this.jwks, issuer: this.issuer };
  }
}
