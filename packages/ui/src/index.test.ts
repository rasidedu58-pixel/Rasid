import { describe, expect, it } from "vitest";
import { UI_PACKAGE_PLACEHOLDER } from "./index";

describe("ui package placeholder", () => {
  it("exports a placeholder marker", () => {
    expect(UI_PACKAGE_PLACEHOLDER).toBe(true);
  });
});
