/**
 * Postgres error helpers for concurrency-safe writes.
 *
 * The `postgres` driver (porsager/postgres) throws errors that copy the
 * server's error fields — notably the SQLSTATE `code` and, for integrity
 * violations, the `constraint_name`. These helpers let a repository turn a
 * lost INSERT race (two near-simultaneous identical writes) into a
 * deterministic domain outcome — "already exists" / re-read the winner's row
 * — instead of bubbling a raw 500 to the user who merely lost the race by a
 * millisecond. The UNIQUE constraint stays the real guarantee in the DB; this
 * is only how we CLASSIFY the violation, always by the specific constraint
 * name so a DIFFERENT-intent conflict is never silently swallowed as success.
 */
const UNIQUE_VIOLATION = "23505";

export function isPostgresError(err: unknown): err is { code?: string; constraint_name?: string; table_name?: string; detail?: string } {
  return !!err && typeof err === "object" && "code" in err;
}

/**
 * True when `err` is a Postgres unique-violation (23505). When
 * `constraintName` is given, ALSO requires the violated constraint to be that
 * exact one — so mapping stays scoped to the intended invariant and never
 * treats an unrelated unique conflict as the same thing.
 */
export function isUniqueViolation(err: unknown, constraintName?: string): boolean {
  if (!isPostgresError(err)) return false;
  if (err.code !== UNIQUE_VIOLATION) return false;
  if (constraintName === undefined) return true;
  return err.constraint_name === constraintName;
}
