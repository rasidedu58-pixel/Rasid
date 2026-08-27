/**
 * Notifications repository — Phase 9.
 *
 * `listForUser`/`markRead`/`markAllRead` run on `app_runtime` (the
 * `notifications_owner_access` RLS policy — workspace_id AND user_id both
 * must match the ambient context, migration 0043). `insertDeduped` runs on
 * `app_worker` (the `notifications_worker_insert` policy — workspace_id
 * only) and is the ONLY write path that ever creates a notification — see
 * `worker/notifications-scan.ts`.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { notifications } from "../schema/notifications";
import type { Db } from "./identity.repository";

export type NotificationRow = typeof notifications.$inferSelect;
export type NotificationType = "SUBSCRIPTION_EXPIRING" | "FOLLOWUP_DUE" | "MISSING_RECORDS";

export async function listNotificationsForUser(
  db: Db,
  params: { workspaceId: string; userId: string; unreadOnly?: boolean; limit?: number },
): Promise<NotificationRow[]> {
  const conditions = [eq(notifications.workspaceId, params.workspaceId), eq(notifications.userId, params.userId)];
  if (params.unreadOnly) conditions.push(isNull(notifications.readAt));
  return db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(params.limit ?? 50);
}

export async function countUnreadForUser(db: Db, params: { workspaceId: string; userId: string }): Promise<number> {
  // Phase 15C — DB-side COUNT(*) (one row back) instead of SELECTing every
  // unread id and counting them in JS. Same value, no per-row transfer.
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.workspaceId, params.workspaceId), eq(notifications.userId, params.userId), isNull(notifications.readAt)));
  return row?.count ?? 0;
}

export interface NotificationsPage {
  rows: NotificationRow[];
  unreadCount: number;
}

/**
 * Phase 15C — the whole `GET /notifications` payload (the page of rows AND
 * the total unread count) in ONE transaction. The list endpoint used to open
 * TWO separate `withRuntimeContext` transactions — one for the rows, one for
 * the count — for a response that is always a single small page. This runs
 * the SAME two queries (`listNotificationsForUser` + the DB-side
 * `countUnreadForUser`) on one connection inside one transaction; postgres.js
 * pipelines the pair, so it keeps the concurrency of the old two-transaction
 * `Promise.all` while paying one BEGIN/COMMIT. No visibility, ordering,
 * unread-state, or user/workspace-scoping logic changes — both queries carry
 * the exact same workspace_id + user_id predicates as before (RLS unchanged).
 */
export async function loadNotificationsPage(
  db: Db,
  params: { workspaceId: string; userId: string; limit?: number },
): Promise<NotificationsPage> {
  const [rows, unreadCount] = await Promise.all([
    listNotificationsForUser(db, params),
    countUnreadForUser(db, params),
  ]);
  return { rows, unreadCount };
}

/** Column-restricted UPDATE (`read_at` only) — matches the grant exactly (migration 0043). Scoped to the caller's own notification via the RLS policy AND an explicit id match; a foreign/nonexistent id simply updates 0 rows (safe no-leak — never a distinguishable 403/404). */
export async function markNotificationRead(db: Db, params: { workspaceId: string; userId: string; id: string }): Promise<boolean> {
  const result = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.workspaceId, params.workspaceId), eq(notifications.userId, params.userId), eq(notifications.id, params.id), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return result.length > 0;
}

export async function markAllNotificationsRead(db: Db, params: { workspaceId: string; userId: string }): Promise<number> {
  const result = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.workspaceId, params.workspaceId), eq(notifications.userId, params.userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return result.length;
}

// ---------------------------------------------------------------------------
// Worker-only write path
// ---------------------------------------------------------------------------

export interface InsertNotificationInput {
  workspaceId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
  dedupKey: string;
}

/**
 * `ON CONFLICT DO NOTHING` against `notifications_dedup_unique`
 * (workspace_id, user_id, type, entity_type, entity_id, dedup_key) — safe
 * under concurrent/retried worker scans by construction, not by a
 * check-then-insert race. Returns whether a NEW row was actually created
 * (false = it already existed, a genuine no-op).
 *
 * `RETURNING` deliberately projects a LITERAL (`true`), never a real table
 * column: Postgres requires SELECT privilege on any column REFERENCED by a
 * RETURNING clause, and `app_worker` is intentionally granted INSERT only
 * on `notifications` (migration 0043's own doc comment — it never reads
 * back, never marks read, never deletes). Returning a literal answers
 * "was a row created?" without ever needing that SELECT grant.
 */
export async function insertDedupedNotification(workerDb: Db, input: InsertNotificationInput): Promise<boolean> {
  const inserted = await workerDb
    .insert(notifications)
    .values({
      workspaceId: input.workspaceId,
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      entityType: input.entityType,
      entityId: input.entityId,
      dedupKey: input.dedupKey,
    })
    .onConflictDoNothing()
    .returning({ inserted: sql<boolean>`true` });
  return inserted.length > 0;
}
