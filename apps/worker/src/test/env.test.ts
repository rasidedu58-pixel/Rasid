import { describe, expect, it } from "vitest";
import { getRedisUrl, loadWorkerEnv } from "../config/env";

describe("worker env", () => {
  it("loads without REDIS_URL set", () => {
    const env = loadWorkerEnv({});
    expect(env.REDIS_URL).toBeUndefined();
  });

  it("throws only when Redis connection is actually requested without REDIS_URL", () => {
    expect(() => getRedisUrl({})).toThrow();
  });

  it("returns the URL when configured", () => {
    const url = getRedisUrl({ REDIS_URL: "redis://localhost:6379" });
    expect(url).toBe("redis://localhost:6379");
  });
});
