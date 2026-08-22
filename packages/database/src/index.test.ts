import { describe, expect, it } from "vitest";
import { getDatabaseUrl, loadDatabaseEnv } from "./env";

describe("database package env", () => {
  it("loads without DATABASE_URL set", () => {
    const env = loadDatabaseEnv({});
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it("throws only when a connection is actually requested without DATABASE_URL", () => {
    expect(() => getDatabaseUrl({})).toThrow();
  });

  it("returns the URL when configured", () => {
    const url = getDatabaseUrl({ DATABASE_URL: "postgresql://localhost:5432/test" });
    expect(url).toBe("postgresql://localhost:5432/test");
  });
});
