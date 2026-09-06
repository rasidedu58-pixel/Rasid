import { describe, expect, it } from "vitest";
import { coerceTimestamp } from "./platform-admin.repository";

describe("coerceTimestamp — operational snapshot lastActivityAt (regression)", () => {
  it("turns a raw postgres.js max() STRING into a Date so .toISOString() never TypeErrors", () => {
    // This is the exact production crash: max(created_at) came back as a string
    // and the caller did string.toISOString() → TypeError: ...is not a function.
    const raw = "2026-09-03 22:15:00+00";
    const d = coerceTimestamp(raw);
    expect(d).toBeInstanceOf(Date);
    expect(() => d!.toISOString()).not.toThrow();
    expect(d!.toISOString()).toBe(new Date(raw).toISOString());
  });

  it("passes a Date through and maps missing values to null (no crash on empty history)", () => {
    const now = new Date();
    expect(coerceTimestamp(now)).toBeInstanceOf(Date);
    expect(coerceTimestamp(null)).toBeNull();
    expect(coerceTimestamp(undefined)).toBeNull();
    // A workspace with zero audit events yields max()=null → null, never a crash.
    expect(coerceTimestamp(null)).toBeNull();
  });
});
