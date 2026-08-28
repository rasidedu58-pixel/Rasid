import { describe, expect, it } from "vitest";
import { scrubEvent } from "./sentry";

/**
 * Phase 15G — proves the Sentry `beforeSend` scrubber (the single
 * enforcement point that stops PII/secrets leaving the process) actually
 * strips what the security contract forbids. This is the automated
 * sanitization test §6 requires.
 */
describe("scrubEvent (Sentry beforeSend PII/secret guard)", () => {
  it("drops the request body, cookies, and headers wholesale — keeps only method + query-stripped url", () => {
    const scrubbed = scrubEvent({
      request: {
        method: "POST",
        url: "https://api.example.com/api/v1/students?token=leak",
        data: { studentName: "طالب", guardianPhone: "01012345678", note: "sensitive note" },
        cookies: "sb-access-token=eyJ...; other=1",
        headers: { authorization: "Bearer eyJhbGciOi...", cookie: "sb=..." },
      },
    });
    expect(scrubbed.request).toEqual({ method: "POST", url: "https://api.example.com/api/v1/students" });
    // No body/cookies/headers survive.
    const req = scrubbed.request as Record<string, unknown>;
    expect(req.data).toBeUndefined();
    expect(req.cookies).toBeUndefined();
    expect(req.headers).toBeUndefined();
  });

  it("redacts secret-shaped keys and masks phone numbers inside extra/contexts/tags/user", () => {
    const scrubbed = scrubEvent({
      extra: { access_token: "eyJ...", password: "hunter2", guardianPhone: "01099998888" },
      user: { id: "user-1", email: "a@b.test", authorization: "Bearer x" },
      tags: { service: "api", api_key: "sk_live_1" },
      contexts: { billing: { paddleWebhookSecret: "whsec_1", amount: 60000 } },
    }) as {
      extra: Record<string, string>;
      user: Record<string, string>;
      tags: Record<string, string>;
      contexts: { billing: Record<string, unknown> };
    };
    expect(scrubbed.extra.access_token).toBe("[REDACTED]");
    expect(scrubbed.extra.password).toBe("[REDACTED]");
    expect(scrubbed.extra.guardianPhone).toBe("*******8888");
    expect(scrubbed.user.authorization).toBe("[REDACTED]");
    expect(scrubbed.tags.api_key).toBe("[REDACTED]");
    expect(scrubbed.contexts.billing.paddleWebhookSecret).toBe("[REDACTED]");
    // Non-sensitive values are preserved for debuggability.
    expect(scrubbed.tags.service).toBe("api");
    expect(scrubbed.contexts.billing.amount).toBe(60000);
  });

  it("does not throw on an event with no request/extra sections", () => {
    expect(() => scrubEvent({ message: "hello", level: "error" })).not.toThrow();
  });
});
