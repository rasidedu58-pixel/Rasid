import { z } from "zod";

/**
 * Platform Issues Center — "حالة المنصة والمشكلات". A LEAN operational
 * status aggregator: it derives Rasid's current health from real signals
 * (API /health, DB /ready, and the outbox_events worker queue) — it is NOT an
 * incident-management system and persists nothing. Every status is backed by a
 * real source; when a source can't be read, the status is UNKNOWN (never a
 * fabricated "operational").
 */

export const SERVICE_STATUSES = ["OPERATIONAL", "DEGRADED", "DOWN", "UNKNOWN"] as const;
export const serviceStatusSchema = z.enum(SERVICE_STATUSES);
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

export const ISSUE_SEVERITIES = ["INFO", "WARNING", "CRITICAL"] as const;
export const issueSeveritySchema = z.enum(ISSUE_SEVERITIES);
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

export const ISSUE_STATUSES = ["ACTIVE", "RESOLVED"] as const;
export const issueStatusSchema = z.enum(ISSUE_STATUSES);
export type PlatformIssueStatus = (typeof ISSUE_STATUSES)[number];

export const PLATFORM_SERVICE_KEYS = ["web", "api", "database", "worker"] as const;
export type PlatformServiceKey = (typeof PLATFORM_SERVICE_KEYS)[number];

/** A derived, non-persisted issue card. */
export const platformIssueSchema = z.object({
  id: z.string(), // stable derived key (e.g. "api-down", "worker-dead-letters")
  title: z.string(),
  affectedPart: z.string(),
  severity: issueSeveritySchema,
  status: issueStatusSchema,
  startedAt: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  description: z.string(),
  ctaHref: z.string().nullable(),
});
export type PlatformIssue = z.infer<typeof platformIssueSchema>;

/** A recent operational failure (from the worker queue) — sanitized, never raw logs. */
export const platformRecentProblemSchema = z.object({
  at: z.string(),
  part: z.string(),
  summary: z.string(),
  resolved: z.boolean(),
});
export type PlatformRecentProblem = z.infer<typeof platformRecentProblemSchema>;

export const workerJobsSnapshotSchema = z.object({
  pending: z.number().int(),
  retrying: z.number().int(),
  dead: z.number().int(),
});
export type WorkerJobsSnapshot = z.infer<typeof workerJobsSnapshotSchema>;

/**
 * The server-known part of platform status. `api` and `web` liveness are added
 * CLIENT-side (proven by the page being served and the request succeeding).
 * `worker`/`jobs`/`recentProblems` require the 0057 outbox read grant; until
 * it's applied `workerSource:"unavailable"` and worker status is UNKNOWN.
 * `jobs`/`recentProblems` are omitted (null/empty) for callers without
 * platform.health.details.
 */
export const platformStatusResponseSchema = z.object({
  database: serviceStatusSchema,
  worker: serviceStatusSchema,
  workerSource: z.enum(["available", "unavailable"]),
  jobs: workerJobsSnapshotSchema.nullable(),
  activeIssues: z.array(platformIssueSchema),
  recentProblems: z.array(platformRecentProblemSchema),
  generatedAt: z.string(),
});
export type PlatformStatusResponse = z.infer<typeof platformStatusResponseSchema>;

/**
 * Deterministic overall-status derivation (NO AI). Critical services are
 * web/api/database; the worker being unhealthy is DEGRADED, not full DOWN.
 * Order matters: DOWN dominates, then DEGRADED, then a clean OPERATIONAL,
 * else UNKNOWN when we can't even confirm the criticals.
 */
export function deriveOverallStatus(services: Record<PlatformServiceKey, ServiceStatus>): ServiceStatus {
  const critical: ServiceStatus[] = [services.web, services.api, services.database];
  if (critical.includes("DOWN")) return "DOWN";
  if (Object.values(services).includes("DEGRADED")) return "DEGRADED";
  // Worker DOWN is treated as DEGRADED overall (app still serves).
  if (services.worker === "DOWN") return "DEGRADED";
  if (critical.every((s) => s === "OPERATIONAL")) return "OPERATIONAL";
  return "UNKNOWN";
}
