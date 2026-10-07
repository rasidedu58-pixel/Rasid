#!/usr/bin/env node
/**
 * Generate the auth secrets GoTrue needs, with ZERO dependencies so it can run
 * on the server with nothing but the system node.
 *
 * WHY ASYMMETRIC IS MANDATORY HERE: the API verifies tokens with a remote
 * JWKS only (jose.createRemoteJWKSet); there is no shared-secret code path.
 * So GoTrue must sign with a private EC key and publish the public half at
 * /auth/v1/.well-known/jwks.json.
 *
 * WHY THE SYMMETRIC SECRET IS STILL PRODUCED: self-hosted GoTrue keeps a
 * legacy symmetric key inside JWT_KEYS alongside the EC key, and the legacy
 * anon key is an HS256 JWT signed with that secret. supabase-js requires an
 * anon key to send as `apikey`, so we mint a well-formed one.
 *
 * Usage:
 *   node generate-auth-keys.mjs --issuer https://host/auth/v1          # print
 *   node generate-auth-keys.mjs --issuer https://host/auth/v1 --env    # env lines
 *
 * The output contains PRIVATE key material. Write it straight into
 * /etc/rasid/gotrue.env (mode 640) and never paste it into a chat, an issue,
 * or a commit.
 */
import { generateKeyPairSync, randomBytes, createHmac, createHash } from "node:crypto";

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : undefined;
};
const issuer = getArg("issuer");
const asEnv = args.includes("--env");

if (!issuer) {
  console.error("FATAL: --issuer is required, e.g. --issuer https://rasid.example/auth/v1");
  console.error("       It MUST equal <SUPABASE_URL>/auth/v1 exactly; a mismatch makes every");
  console.error("       request fail with a valid-looking token.");
  process.exit(1);
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");

// ── 1. The symmetric secret (legacy key + anon-key signer) ──────────────────
const jwtSecret = randomBytes(48).toString("base64url");

// ── 2. The EC P-256 signing key pair (ES256) ────────────────────────────────
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const privJwk = privateKey.export({ format: "jwk" });
const pubJwk = publicKey.export({ format: "jwk" });

// RFC 7638 thumbprint as the key id: deterministic from the key itself, so the
// same key always carries the same kid and rotation is unambiguous.
const thumbInput = JSON.stringify({ crv: pubJwk.crv, kty: pubJwk.kty, x: pubJwk.x, y: pubJwk.y });
const kid = createHash("sha256").update(thumbInput).digest("base64url");

const ecSigningKey = { ...privJwk, kid, use: "sig", alg: "ES256" };
const symmetricKey = { kty: "oct", k: Buffer.from(jwtSecret).toString("base64url"), kid: "legacy-hs256", use: "sig", alg: "HS256" };

// GOTRUE_JWT_KEYS is a JSON array of signing JWKs: the EC private key (used to
// sign new tokens) plus the legacy symmetric key. GoTrue excludes the
// symmetric key from the published JWKS, so only the EC public half is served.
const jwtKeys = JSON.stringify([ecSigningKey, symmetricKey]);

// ── 3. The anon key: an HS256 JWT, exactly as the legacy Supabase one ───────
// With standalone GoTrue (no API gateway in front) this is NOT an access
// boundary — the real gate is the API's token verification plus database
// authorization. It exists because supabase-js demands one.
const now = Math.floor(Date.now() / 1000);
const anonHeader = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
const anonPayload = b64url(
  JSON.stringify({ role: "anon", iss: "supabase", iat: now, exp: now + 60 * 60 * 24 * 365 * 10 }),
);
const anonSig = createHmac("sha256", jwtSecret).update(`${anonHeader}.${anonPayload}`).digest("base64url");
const anonKey = `${anonHeader}.${anonPayload}.${anonSig}`;

// ── 4. Output ───────────────────────────────────────────────────────────────
if (asEnv) {
  console.log(`GOTRUE_JWT_SECRET=${jwtSecret}`);
  console.log(`GOTRUE_JWT_KEYS=${jwtKeys}`);
  console.log(`GOTRUE_JWT_VALID_METHODS=ES256`);
  console.log(`GOTRUE_JWT_ISSUER=${issuer}`);
} else {
  console.log("# --- paste into /etc/rasid/gotrue.env (mode 640 root:rasid) ---");
  console.log(`GOTRUE_JWT_SECRET=${jwtSecret}`);
  console.log(`GOTRUE_JWT_KEYS=${jwtKeys}`);
  console.log(`GOTRUE_JWT_VALID_METHODS=ES256`);
  console.log(`GOTRUE_JWT_ISSUER=${issuer}`);
  console.log("");
  console.log("# --- the anon key is PUBLIC: it is compiled into the web bundle ---");
  console.log("# Pass it to the 'Build deploy artifacts' workflow as `anon_key`.");
  console.log(`ANON_KEY=${anonKey}`);
  console.log("");
  console.log(`# key id (kid) of the signing key: ${kid}`);
  console.log("# After GoTrue starts, prove the public half is served:");
  console.log(`#   curl -s ${issuer}/.well-known/jwks.json | jq '.keys[] | {kty,crv,alg,kid}'`);
  console.log("# It must show kty=EC, crv=P-256, alg=ES256 and this kid — and must");
  console.log("# NOT contain the symmetric key.");
}
