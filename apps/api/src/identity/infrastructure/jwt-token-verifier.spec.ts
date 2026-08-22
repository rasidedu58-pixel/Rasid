import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet, type JWTVerifyGetKey, type KeyLike } from "jose";
import type { ServerEnv } from "@academic-precision/config/server";
import {
  JwtTokenVerifier,
  TokenExpiredVerificationError,
  InvalidTokenVerificationError,
} from "./jwt-token-verifier";

const ISSUER = "https://project-ref.supabase.co/auth/v1";
const KID = "test-signing-key-1";
const ALG = "ES256";

/** Env with only SUPABASE_URL set — the verifier never needs a JWT secret. */
function makeEnv(): ServerEnv {
  return { SUPABASE_URL: "https://project-ref.supabase.co" } as ServerEnv;
}

/** Builds one ES256 keypair and a local JWKS exposing its public key under KID. */
async function buildKeys() {
  const { publicKey, privateKey } = await generateKeyPair(ALG);
  const jwk = await exportJWK(publicKey);
  jwk.kid = KID;
  jwk.alg = ALG;
  jwk.use = "sig";
  const jwks: JWTVerifyGetKey = createLocalJWKSet({ keys: [jwk] });
  return { privateKey, jwks };
}

function signToken(
  privateKey: KeyLike,
  overrides: { kid?: string; issuer?: string; sub?: string; iat?: number; exp?: string | number } = {},
) {
  const builder = new SignJWT({ email: "owner@example.com" })
    .setProtectedHeader({ alg: ALG, kid: overrides.kid ?? KID })
    .setIssuedAt(overrides.iat)
    .setIssuer(overrides.issuer ?? ISSUER)
    .setSubject(overrides.sub ?? "user-123");

  return overrides.exp !== undefined ? builder.setExpirationTime(overrides.exp).sign(privateKey) : builder.setExpirationTime("1h").sign(privateKey);
}

describe("JwtTokenVerifier (Supabase JWKS/asymmetric verification)", () => {
  it("verifies a valid token, selecting the key by kid and returning sub/email", async () => {
    const { privateKey, jwks } = await buildKeys();
    const token = await signToken(privateKey);

    const verifier = new JwtTokenVerifier(makeEnv(), jwks, ISSUER);
    const result = await verifier.verify(token);

    expect(result).toEqual({ id: "user-123", email: "owner@example.com" });
  });

  it("rejects an expired token with TokenExpiredVerificationError", async () => {
    const { privateKey, jwks } = await buildKeys();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = await signToken(privateKey, { iat: nowSeconds - 3600, exp: nowSeconds - 60 });

    const verifier = new JwtTokenVerifier(makeEnv(), jwks, ISSUER);

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(TokenExpiredVerificationError);
  });

  it("rejects a token issued by the wrong issuer", async () => {
    const { privateKey, jwks } = await buildKeys();
    const token = await signToken(privateKey, { issuer: "https://not-our-project.supabase.co/auth/v1" });

    const verifier = new JwtTokenVerifier(makeEnv(), jwks, ISSUER);

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(InvalidTokenVerificationError);
  });

  it("rejects a token with an invalid signature (kid resolves to a different key than the one that signed it)", async () => {
    const { jwks } = await buildKeys(); // JWKS publishes key A's public key under KID
    const { privateKey: impostorPrivateKey } = await generateKeyPair(ALG); // key B — never published
    const token = await signToken(impostorPrivateKey); // claims KID (key A) via header, actually signed by B

    const verifier = new JwtTokenVerifier(makeEnv(), jwks, ISSUER);

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(InvalidTokenVerificationError);
  });

  it("rejects a token referencing an unknown/rotated-out kid", async () => {
    const { privateKey, jwks } = await buildKeys();
    const token = await signToken(privateKey, { kid: "old-rotated-out-key" });

    const verifier = new JwtTokenVerifier(makeEnv(), jwks, ISSUER);

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(InvalidTokenVerificationError);
  });

  it("rejects a missing/empty token", async () => {
    const { jwks } = await buildKeys();
    const verifier = new JwtTokenVerifier(makeEnv(), jwks, ISSUER);

    await expect(verifier.verify("")).rejects.toBeInstanceOf(InvalidTokenVerificationError);
  });
});
