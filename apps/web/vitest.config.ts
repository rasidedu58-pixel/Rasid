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
    // Each test FILE runs in its own forked process with a fresh module registry,
    // and mock/spy state is reset between tests. Several component tests here mock
    // the SAME modules (workspace-provider, next/navigation, supabase-client) via
    // module-level state + dynamic import(); without hard per-file isolation those
    // mocks/timers leaked across files, making verify-email / months-page /
    // platform-admin-authz spuriously fail only when run together (they pass alone).
    pool: "forks",
    isolate: true,
    restoreMocks: true,
    clearMocks: true,
    unstubGlobals: true,
    // waitFor-based async assertions need headroom under a loaded CI machine.
    testTimeout: 15000,
  },
});
