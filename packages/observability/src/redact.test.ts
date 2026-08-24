import { describe, expect, it } from "vitest";
import { redactLogObject } from "./redact";

describe("redactLogObject (Phase 10 — PII/secret log redaction)", () => {
  it("fully redacts secret-shaped fields", () => {
    const result = redactLogObject({ password: "hunter2", authToken: "abc.def.ghi", apiKey: "sk_live_123", qrRawToken: "raw-token-value" });
    expect(result.password).toBe("[REDACTED]");
    expect(result.authToken).toBe("[REDACTED]");
    expect(result.apiKey).toBe("[REDACTED]");
    expect(result.qrRawToken).toBe("[REDACTED]");
  });

  it("masks (not removes) guardian phone numbers — last 4 digits stay visible", () => {
    const result = redactLogObject({ guardianPhone: "01012345678" });
    expect(result.guardianPhone).toBe("*******5678");
    expect(result.guardianPhone).not.toBe("01012345678");
  });

  it("redacts nested secrets inside a request/error context object", () => {
    const result = redactLogObject({
      req: { headers: { authorization: "Bearer secret-jwt" } },
      error: { message: "failed", stack: "at x", context: { paddleWebhookSecret: "whsec_123" } },
    }) as { req: { headers: { authorization: string } }; error: { context: { paddleWebhookSecret: string } } };
    expect(result.req.headers.authorization).toBe("[REDACTED]");
    expect(result.error.context.paddleWebhookSecret).toBe("[REDACTED]");
  });

  it("leaves ordinary structured fields untouched", () => {
    const result = redactLogObject({ level: 30, msg: "Outbox dispatch cycle completed.", claimed: 5, processed: 4, workspaceId: "ws-1" });
    expect(result).toEqual({ level: 30, msg: "Outbox dispatch cycle completed.", claimed: 5, processed: 4, workspaceId: "ws-1" });
  });

  it("does not choke on null/undefined/primitive values", () => {
    expect(() => redactLogObject({ a: null, b: undefined, c: 1, d: "text", e: true })).not.toThrow();
  });

  it("handles arrays of objects containing secrets", () => {
    const result = redactLogObject({ items: [{ token: "t1" }, { token: "t2" }] }) as { items: Array<{ token: string }> };
    expect(result.items[0]!.token).toBe("[REDACTED]");
    expect(result.items[1]!.token).toBe("[REDACTED]");
  });
});
