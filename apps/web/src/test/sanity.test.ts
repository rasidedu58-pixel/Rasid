import { describe, expect, it } from "vitest";

describe("apps/web sanity", () => {
  it("runs a trivial passing test", () => {
    expect(1 + 1).toBe(2);
  });
});
