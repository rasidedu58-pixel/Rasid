import { z } from "zod";

/**
 * Permission Catalog — PRD §35 (Permission Catalog and Enforcement), encoded
 * exactly. Not a database table: the approved Database Schema defines no
 * columns/table for the catalog itself (only permission_grants, which
 * *references* a permission_key from this catalog), and the PRD states
 * dependency resolution happens server-side — so this is a shared
 * TypeScript constant, not a migration.
 *
 * Shared between apps/api (enforcement) and, potentially, apps/web (e.g.
 * rendering a permission-picker UI) — hence living in @academic-precision/contracts
 * rather than being apps/api-internal.
 */

export const PERMISSION_KEYS = [
  "students.view_basic",
  "students.edit",
  "attendance.read",
  "attendance.write",
  "homework.read",
  "homework.write",
  "exams.read",
  "exams.write",
  "payments.view_student_status",
  "payments.record",
  "finance.overview",
  "parent_contact",
  "followup.read",
  "followup.write",
  "reports.view",
  "reports.export",
  "groups.view",
  "groups.manage",
  "sessions.manage",
  "team.manage",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const permissionKeySchema = z.enum(PERMISSION_KEYS);

export const PERMISSION_KEY_SET: ReadonlySet<PermissionKey> = new Set(PERMISSION_KEYS);

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSION_KEY_SET as Set<string>).has(value);
}

/**
 * Direct dependency ("implied grant") edges — PRD §35's "Dependency /
 * scope" column, e.g. `students.edit` implies `students.view_basic`.
 * `payments.record` deliberately does NOT imply `finance.overview` (PRD
 * §35 states this explicitly — asserted by a dedicated test).
 */
export const PERMISSION_DEPENDENCIES: Readonly<Record<PermissionKey, readonly PermissionKey[]>> = {
  "students.view_basic": [],
  "students.edit": ["students.view_basic"],
  "attendance.read": [],
  "attendance.write": ["attendance.read"],
  "homework.read": [],
  "homework.write": ["homework.read"],
  "exams.read": [],
  "exams.write": ["exams.read"],
  "payments.view_student_status": ["students.view_basic"],
  "payments.record": ["payments.view_student_status"],
  "finance.overview": [],
  parent_contact: ["students.view_basic"],
  "followup.read": [],
  "followup.write": ["followup.read"],
  "reports.view": [],
  "reports.export": ["reports.view"],
  "groups.view": [],
  "groups.manage": ["groups.view"],
  "sessions.manage": ["groups.view"],
  "team.manage": [],
};

/**
 * Scope type each permission requires when granted. Per PRD §35/API
 * Contract §10: every permission requires Group scope except
 * `finance.overview` and `team.manage`, which are workspace-level
 * ("Allowed scope" / "Workspace" respectively — no group_id needed).
 */
export type CatalogScopeKind = "GROUP" | "WORKSPACE";

export const PERMISSION_SCOPE_KIND: Readonly<Record<PermissionKey, CatalogScopeKind>> = {
  "students.view_basic": "GROUP",
  "students.edit": "GROUP",
  "attendance.read": "GROUP",
  "attendance.write": "GROUP",
  "homework.read": "GROUP",
  "homework.write": "GROUP",
  "exams.read": "GROUP",
  "exams.write": "GROUP",
  "payments.view_student_status": "GROUP",
  "payments.record": "GROUP",
  "finance.overview": "WORKSPACE",
  parent_contact: "GROUP",
  "followup.read": "GROUP",
  "followup.write": "GROUP",
  "reports.view": "GROUP",
  "reports.export": "GROUP",
  "groups.view": "GROUP",
  "groups.manage": "GROUP",
  "sessions.manage": "GROUP",
  "team.manage": "WORKSPACE",
};

/** `team.manage` is Owner-only in V1 — no non-owner grant may ever be created (PRD §35). */
export const OWNER_ONLY_PERMISSION_KEYS: ReadonlySet<PermissionKey> = new Set(["team.manage"]);

/**
 * Computes the dependency closure (this permission + everything it
 * transitively implies) for a single permission key. Used both at grant
 * time (validate a requested grant set is coherent) and at request time
 * (derive the true effective-permission set instead of trusting stored rows).
 */
export function closurePermissionKeys(key: PermissionKey): Set<PermissionKey> {
  const result = new Set<PermissionKey>();
  const stack: PermissionKey[] = [key];
  while (stack.length > 0) {
    const current = stack.pop() as PermissionKey;
    if (result.has(current)) continue;
    result.add(current);
    for (const dep of PERMISSION_DEPENDENCIES[current]) {
      if (!result.has(dep)) stack.push(dep);
    }
  }
  return result;
}
