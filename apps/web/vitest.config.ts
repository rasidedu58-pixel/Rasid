import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig.json sets `"jsx": "preserve"` (Next's own compiler resolves
  // JSX at build time) — vitest's esbuild transform needs to be told
  // explicitly to use the automatic runtime, or `.tsx` test/source files
  // render with "ReferenceError: React is not defined" (no test here
  // rendered a component via JSX before this file was added).
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
