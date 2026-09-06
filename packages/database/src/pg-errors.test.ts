import { describe, expect, it } from "vitest";
import { isPostgresError, isUniqueViolation } from "./pg-errors";

// Shape mirrors what the `postgres` (porsager) driver throws for an integrity
// violation: the SQLSTATE `code` plus `constraint_name`.
const uniqueViolation = (constraint: string) => ({ code: "23505", constraint_name: constraint, table_name: "enrollments" });

describe("pg-errors", () => {
  it("isPostgresError recognizes a driver error and rejects plain values", () => {
    expect(isPostgresError(uniqueViolation("x"))).toBe(true);
    expect(isPostgresError(new Error("boom"))).toBe(false);
    expect(isPostgresError(null)).toBe(false);
    expect(isPostgresError("23505")).toBe(false);
    expect(isPostgresError(undefined)).toBe(false);
  });

  it("isUniqueViolation is true for any 23505 when no constraint is named", () => {
    expect(isUniqueViolation(uniqueViolation("enrollments_student_group_month_unique"))).toBe(true);
    expect(isUniqueViolation({ code: "23503" })).toBe(false); // FK violation, not unique
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
  });

  it("scopes to the exact constraint when named — a DIFFERENT unique conflict is NOT swallowed", () => {
    const err = uniqueViolation("enrollments_student_group_month_unique");
    expect(isUniqueViolation(err, "enrollments_student_group_month_unique")).toBe(true);
    // A different unique violation must NOT be treated as this invariant
    // (mapping is always by constraint name — never a blanket 23505 catch).
    expect(isUniqueViolation(err, "students_workspace_student_code_unique")).toBe(false);
  });
});
