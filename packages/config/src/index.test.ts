import { describe, expect, it } from "vitest";
import { loadBrowserEnv } from "./browser";
import { loadServerEnv } from "./server";

describe("config package", () => {
  it("loads browser env with no required values", () => {
    const env = loadBrowserEnv({});
    expect(env).toEqual({});
  });

  it("loads server env with no required values", () => {
    const env = loadServerEnv({});
    expect(env).toEqual({});
  });

  it("coerces PORT to a number when present", () => {
    const env = loadServerEnv({ PORT: "3000" });
    expect(env.PORT).toBe(3000);
  });
});
