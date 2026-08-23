import { defineConfig } from "vitest/config";

/**
 * This package's `*-security.integration.test.ts` files (rls-security,
 * scheduling-security, students-security) each open their own admin +
 * app_runtime connections against the SAME live Supabase project when real
 * credentials are present, and all import the SAME `getDb()` singleton
 * connection pool from `./src/connection.ts`. Running these files in
 * parallel (Vitest's default) let them contend for that shared pool and for
 * the remote database's own connection/CPU budget simultaneously, which
 * intermittently pushed individual live round-trips past the 5s default
 * test timeout under load — a real flake, not a functional regression
 * (every affected test passes reliably when its file runs in isolation;
 * verified repeatedly). Running test FILES sequentially (not the tests
 * within a file, which stay fast, in-order, and already correctly ordered)
 * removes the cross-file contention entirely; the modest wall-clock cost is
 * an acceptable trade for eliminating this flake class outright. The
 * generous `testTimeout` is a second, independent safety margin for the
 * live-network round-trips this package's integration suites make even
 * when running alone (e.g. under CI runner network variance).
 */
export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 20000,
  },
});
