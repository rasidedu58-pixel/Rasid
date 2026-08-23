/**
 * Paddle webhook signature verification — Phase 8. Pure (no DB access,
 * no network), so it is independently unit-testable against fixed
 * secrets/timestamps.
 *
 * Implements Paddle's own documented `Paddle-Signature` header scheme
 * (`ts=<unix-seconds>;h1=<hex-hmac-sha256>`) directly against Node's
 * built-in `crypto` module — this repo has no Paddle SDK dependency
 * installed, so hand-implementing the documented algorithm (rather than
 * pulling in an unverified/unavailable SDK) is the correct choice here;
 * the algorithm itself is Paddle's own published spec, not invented.
 *
 * MUST be called with the EXACT raw HTTP body bytes as Paddle sent them,
 * BEFORE any JSON parsing/transformation — re-serializing a parsed JSON
 * object never reproduces the original byte-for-byte string (key
 * ordering, whitespace, number formatting can all differ), which would
 * make every signature verification fail unpredictably. See
 * `apps/api/src/main.ts`'s content-type parser for how the raw string is
 * captured before `JSON.parse`.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface VerifyPaddleSignatureParams {
  /** The exact raw request body string, unparsed. */
  rawBody: string;
  /** The `Paddle-Signature` header value, e.g. "ts=1671552777;h1=...". */
  signatureHeader: string | undefined | null;
  /** The workspace/account's Paddle webhook signing secret. */
  secret: string;
  /** Reject signatures whose `ts` is older than this many seconds (replay-window). Paddle's own docs recommend 5 seconds of clock-skew tolerance for the SIGNATURE itself, but webhooks can legitimately arrive several seconds late over the network — 300s (5 minutes) is this implementation's own reasonable, documented replay-window choice, not a Paddle-mandated number. */
  maxAgeSeconds?: number;
  /** Injectable for tests; defaults to the real current time. */
  now?: () => Date;
}

export type VerifyPaddleSignatureResult =
  | { valid: true }
  | { valid: false; reason: "MISSING_HEADER" | "MALFORMED_HEADER" | "TIMESTAMP_TOO_OLD" | "SIGNATURE_MISMATCH" };

const DEFAULT_MAX_AGE_SECONDS = 300;

/** Parses `ts=...;h1=...` into its two fields. Returns `undefined` if either is missing/malformed. */
function parseSignatureHeader(header: string): { ts: string; h1: string } | undefined {
  const parts = header.split(";").reduce<Record<string, string>>((acc, part) => {
    const [key, value] = part.split("=");
    if (key && value) acc[key.trim()] = value.trim();
    return acc;
  }, {});
  if (!parts.ts || !parts.h1) return undefined;
  return { ts: parts.ts, h1: parts.h1 };
}

export function verifyPaddleWebhookSignature(params: VerifyPaddleSignatureParams): VerifyPaddleSignatureResult {
  if (!params.signatureHeader) return { valid: false, reason: "MISSING_HEADER" };

  const parsed = parseSignatureHeader(params.signatureHeader);
  if (!parsed) return { valid: false, reason: "MALFORMED_HEADER" };

  const tsSeconds = Number(parsed.ts);
  if (!Number.isFinite(tsSeconds)) return { valid: false, reason: "MALFORMED_HEADER" };

  const now = (params.now ?? (() => new Date()))();
  const ageSeconds = now.getTime() / 1000 - tsSeconds;
  const maxAge = params.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  // Reject both stale AND implausibly-future timestamps (a negative age
  // beyond a small tolerance is just as suspicious as a replayed old one).
  if (ageSeconds > maxAge || ageSeconds < -30) {
    return { valid: false, reason: "TIMESTAMP_TOO_OLD" };
  }

  const signedPayload = `${parsed.ts}:${params.rawBody}`;
  const expectedHex = createHmac("sha256", params.secret).update(signedPayload, "utf8").digest("hex");

  const expectedBuf = Buffer.from(expectedHex, "hex");
  const actualBuf = Buffer.from(parsed.h1, "hex");
  // Buffers of different lengths would make timingSafeEqual throw — a
  // length mismatch is itself just "not a match", not a crash.
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    return { valid: false, reason: "SIGNATURE_MISMATCH" };
  }

  return { valid: true };
}
