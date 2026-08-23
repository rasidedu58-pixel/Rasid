import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyPaddleWebhookSignature } from "./paddle-webhook-verify";

const SECRET = "test-secret-value";

function sign(rawBody: string, tsSeconds: number, secret = SECRET): string {
  const hmac = createHmac("sha256", secret).update(`${tsSeconds}:${rawBody}`, "utf8").digest("hex");
  return `ts=${tsSeconds};h1=${hmac}`;
}

describe("verifyPaddleWebhookSignature", () => {
  it("accepts a correctly-signed, fresh payload", () => {
    const rawBody = JSON.stringify({ event_id: "evt_1", event_type: "subscription.activated" });
    const nowSeconds = Math.floor(Date.now() / 1000);
    const header = sign(rawBody, nowSeconds);

    const result = verifyPaddleWebhookSignature({ rawBody, signatureHeader: header, secret: SECRET });
    expect(result.valid).toBe(true);
  });

  it("rejects a forged signature (wrong secret) — SIGNATURE_MISMATCH", () => {
    const rawBody = JSON.stringify({ event_id: "evt_1" });
    const nowSeconds = Math.floor(Date.now() / 1000);
    const header = sign(rawBody, nowSeconds, "a-completely-different-secret");

    const result = verifyPaddleWebhookSignature({ rawBody, signatureHeader: header, secret: SECRET });
    expect(result).toEqual({ valid: false, reason: "SIGNATURE_MISMATCH" });
  });

  it("rejects a tampered body — the signature no longer matches the (different) raw bytes", () => {
    const originalBody = JSON.stringify({ event_id: "evt_1", amount: 100 });
    const nowSeconds = Math.floor(Date.now() / 1000);
    const header = sign(originalBody, nowSeconds);
    const tamperedBody = JSON.stringify({ event_id: "evt_1", amount: 999999 });

    const result = verifyPaddleWebhookSignature({ rawBody: tamperedBody, signatureHeader: header, secret: SECRET });
    expect(result).toEqual({ valid: false, reason: "SIGNATURE_MISMATCH" });
  });

  it("rejects a missing signature header", () => {
    const result = verifyPaddleWebhookSignature({ rawBody: "{}", signatureHeader: undefined, secret: SECRET });
    expect(result).toEqual({ valid: false, reason: "MISSING_HEADER" });
  });

  it("rejects a malformed header (missing h1 or ts)", () => {
    expect(verifyPaddleWebhookSignature({ rawBody: "{}", signatureHeader: "ts=123", secret: SECRET })).toEqual({
      valid: false,
      reason: "MALFORMED_HEADER",
    });
    expect(verifyPaddleWebhookSignature({ rawBody: "{}", signatureHeader: "h1=abc", secret: SECRET })).toEqual({
      valid: false,
      reason: "MALFORMED_HEADER",
    });
  });

  it("rejects a replayed (stale) timestamp beyond the max-age window — TIMESTAMP_TOO_OLD", () => {
    const rawBody = JSON.stringify({ event_id: "evt_old" });
    const staleTs = Math.floor(Date.now() / 1000) - 3600; // 1 hour old
    const header = sign(rawBody, staleTs);

    const result = verifyPaddleWebhookSignature({ rawBody, signatureHeader: header, secret: SECRET, maxAgeSeconds: 300 });
    expect(result).toEqual({ valid: false, reason: "TIMESTAMP_TOO_OLD" });
  });

  it("rejects an implausible future timestamp beyond tolerance", () => {
    const rawBody = JSON.stringify({ event_id: "evt_future" });
    const futureTs = Math.floor(Date.now() / 1000) + 3600;
    const header = sign(rawBody, futureTs);

    const result = verifyPaddleWebhookSignature({ rawBody, signatureHeader: header, secret: SECRET });
    expect(result).toEqual({ valid: false, reason: "TIMESTAMP_TOO_OLD" });
  });

  it("uses a timing-safe comparison — a same-length wrong signature never throws, just fails cleanly", () => {
    const rawBody = "{}";
    const nowSeconds = Math.floor(Date.now() / 1000);
    const validHex = sign(rawBody, nowSeconds).split("h1=")[1]!;
    const wrongButSameLength = "0".repeat(validHex.length);
    const header = `ts=${nowSeconds};h1=${wrongButSameLength}`;

    expect(() => verifyPaddleWebhookSignature({ rawBody, signatureHeader: header, secret: SECRET })).not.toThrow();
    expect(verifyPaddleWebhookSignature({ rawBody, signatureHeader: header, secret: SECRET })).toEqual({
      valid: false,
      reason: "SIGNATURE_MISMATCH",
    });
  });
});
