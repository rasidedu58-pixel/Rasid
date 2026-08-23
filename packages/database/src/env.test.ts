import { describe, expect, it } from "vitest";
import { getDatabaseUrl, getMigrationDatabaseUrl, getWorkerDatabaseUrl } from "./env";

/**
 * Deployment Closure Delta — proves the exact mechanism `apps/worker`
 * relies on for its fail-fast/no-fallback startup guarantee: `getWorker
 * DatabaseUrl()` never substitutes `DATABASE_URL` (app_runtime) or
 * `MIGRATION_DATABASE_URL` (privileged/BYPASSRLS) when `WORKER_DATABASE_URL`
 * (app_worker) is missing — it throws, always, with no fallback path.
 */
describe("getWorkerDatabaseUrl", () => {
  it("throws a clear error when WORKER_DATABASE_URL is missing, even with DATABASE_URL and MIGRATION_DATABASE_URL both set", () => {
    const source = {
      DATABASE_URL: "postgresql://app_runtime.ref:pw@host:5432/postgres",
      MIGRATION_DATABASE_URL: "postgresql://postgres.ref:pw@host:5432/postgres",
    };
    expect(() => getWorkerDatabaseUrl(source)).toThrow(/WORKER_DATABASE_URL/);
  });

  it("never falls back to DATABASE_URL's value (app_runtime is the wrong role for the worker)", () => {
    const source = { DATABASE_URL: "postgresql://app_runtime.ref:pw@host:5432/postgres" };
    expect(() => getWorkerDatabaseUrl(source)).toThrow();
  });

  it("never falls back to MIGRATION_DATABASE_URL's value (the privileged/BYPASSRLS role must never run the worker)", () => {
    const source = { MIGRATION_DATABASE_URL: "postgresql://postgres.ref:pw@host:5432/postgres" };
    expect(() => getWorkerDatabaseUrl(source)).toThrow();
  });

  it("throws when WORKER_DATABASE_URL is unset entirely (no env vars at all)", () => {
    expect(() => getWorkerDatabaseUrl({})).toThrow(/WORKER_DATABASE_URL/);
  });

  it("returns its OWN value when set, independent of and distinct from DATABASE_URL/MIGRATION_DATABASE_URL", () => {
    const source = {
      DATABASE_URL: "postgresql://app_runtime.ref:pw@host:5432/postgres",
      MIGRATION_DATABASE_URL: "postgresql://postgres.ref:pw@host:5432/postgres",
      WORKER_DATABASE_URL: "postgresql://app_worker.ref:pw@host:5432/postgres",
    };
    expect(getWorkerDatabaseUrl(source)).toBe(source.WORKER_DATABASE_URL);
    expect(getWorkerDatabaseUrl(source)).not.toBe(getDatabaseUrl(source));
    expect(getWorkerDatabaseUrl(source)).not.toBe(getMigrationDatabaseUrl(source));
  });
});
