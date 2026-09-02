import { Inject, Injectable, Optional } from "@nestjs/common";
import { createRemoteJWKSet, jwtVerify, errors as joseErrors, type JWTVerifyGetKey } from "jose";
import { API_ENV } from "../../config/config.module";
import type { ServerEnv } from "@academic-precision/config/server";

/** Verified identity extracted from a Supabase-issued access token. */
export interface VerifiedSupabaseToken {
  id: string;
  email: string | null;
  /**
   * The name the user entered at signup, carried in Supabase Auth
   * `user_metadata.full_name` (set by `signUp({ options: { data: { full_name }}})`).
   * This is the FIRST trusted source of the user's name — provisioning writes it
   * to `users.full_name` so the signup name is never lost. Null when absent
   * (e.g. an invite-based signup that set no metadata name). Optional at the
   * type level so existing test doubles need not set it; the real verifier
   * always populates it (string or null).
   */
  fullName?: string | null;
  /**
   * Signup teacher-profile fields, carried in Supabase `user_metadata`
   * (`phone` / `governorate` / `subject` / `subject_other`, set at signup).
   * Provisioning backfills them into the user's profile ONCE for a brand-new
   * account, so a new signup arrives with a complete profile. Null when absent
   * (an invite-based signup / a legacy account) — the onboarding step is the
   * backstop. Untrusted metadata: validated + normalized before persistence.
   */
  phone?: string | null;
  governorate?: string | null;
  subject?: string | null;
  subjectOther?: string | null;
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
      // Signup name lives in Supabase `user_metadata` (full_name, or name).
      const meta = payload.user_metadata && typeof payload.user_metadata === "object" ? (payload.user_metadata as Record<string, unknown>) : {};
      const rawName = typeof meta.full_name === "string" ? meta.full_name : typeof meta.name === "string" ? meta.name : null;
      const fullName = rawName && rawName.trim().length > 0 ? rawName.trim() : null;
      // Signup teacher-profile metadata (validated/normalized downstream at provisioning).
      const metaStr = (k: string): string | null => (typeof meta[k] === "string" && (meta[k] as string).trim().length > 0 ? (meta[k] as string).trim() : null);
      return {
        id: sub,
        email,
        fullName,
        phone: metaStr("phone"),
        governorate: metaStr("governorate"),
        subject: metaStr("subject"),
        subjectOther: metaStr("subject_other"),
      };
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
