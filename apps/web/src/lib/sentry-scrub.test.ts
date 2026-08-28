import { describe, expect, it } from "vitest";
import { scrubSentryEvent } from "./sentry-scrub";

/**
 * Phase 15G — proves the SERVER-side Sentry scrubber strips what the security
 * contract forbids, equivalently to the browser + node scrubbers.
 */
describe("scrubSentryEvent (server beforeSend PII/secret guard)", () => {
  it("drops request body/cookies/headers — keeps only method + query-stripped url", () => {
    const scrubbed = scrubSentryEvent({
      request: {
        method: "POST",
        url: "https://rasid.example/api/students?token=leak",
        data: { studentName: "طالب", guardianPhone: "01012345678" },
        cookies: "sb-access-token=eyJ...",
        headers: { authorization: "Bearer eyJ...", cookie: "sb=..." },
      },
    });
    expect(scrubbed.request).toEqual({ method: "POST", url: "https://rasid.example/api/students" });
    const req = scrubbed.request as Record<string, unknown>;
    expect(req.data).toBeUndefined();
    expect(req.cookies).toBeUndefined();
    expect(req.headers).toBeUndefined();
  });

  it("redacts secret keys and masks phones in extra/contexts/tags/user", () => {
    const scrubbed = scrubSentryEvent({
      extra: { access_token: "eyJ...", password: "hunter2", guardianPhone: "01099998888" },
      user: { id: "u1", authorization: "Bearer x" },
      tags: { service: "web-server", api_key: "sk_live_1" },
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
    expect(scrubbed.tags.service).toBe("web-server");
    expect(scrubbed.contexts.billing.amount).toBe(60000);
  });

  it("does not throw on an event with no request/extra sections", () => {
    expect(() => scrubSentryEvent({ message: "hello", level: "error" })).not.toThrow();
  });
});
