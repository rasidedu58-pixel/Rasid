import { describe, expect, it } from "vitest";
import { err, isErr, isOk, ok, type MoneyMinor } from "./index";

describe("Result primitive", () => {
  it("wraps a success value", () => {
    const result = ok(42);
    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);
    if (isOk(result)) {
      expect(result.value).toBe(42);
    }
  });

  it("wraps a failure value", () => {
    const result = err("failed");
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBe("failed");
    }
  });
});

describe("MoneyMinor primitive", () => {
  it("represents amounts as integer minor units", () => {
    const price: MoneyMinor = { amountMinor: 1000, currency: "SAR" };
    expect(Number.isInteger(price.amountMinor)).toBe(true);
  });
});
