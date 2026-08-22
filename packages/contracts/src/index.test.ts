import { describe, expect, it } from "vitest";
import { apiErrorSchema, cursorPageSchema } from "./index";
import { z } from "zod";

describe("contracts package", () => {
  it("validates the API error contract shape", () => {
    const result = apiErrorSchema.safeParse({
      error: { code: "NOT_FOUND", message: "not found" },
      requestId: "req_123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed error contract", () => {
    const result = apiErrorSchema.safeParse({ error: { code: "X" } });
    expect(result.success).toBe(false);
  });

  it("validates a cursor page of arbitrary items", () => {
    const schema = cursorPageSchema(z.object({ id: z.string() }));
    const result = schema.safeParse({
      items: [{ id: "1" }],
      page: { nextCursor: null, hasNext: false },
    });
    expect(result.success).toBe(true);
  });
});
