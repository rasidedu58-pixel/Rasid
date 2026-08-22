import { describe, expect, it } from "vitest";
import { createLogger, createNoopErrorReporter, getContext, runWithContext } from "./index";

describe("observability package", () => {
  it("creates a pino logger", () => {
    const logger = createLogger("test");
    expect(typeof logger.info).toBe("function");
  });

  it("runs context via AsyncLocalStorage", () => {
    runWithContext({ requestId: "req_123" }, () => {
      expect(getContext()?.requestId).toBe("req_123");
    });
    expect(getContext()).toBeUndefined();
  });

  it("no-op error reporter does not throw", () => {
    const reporter = createNoopErrorReporter();
    expect(() => reporter.captureException(new Error("test"))).not.toThrow();
  });
});
