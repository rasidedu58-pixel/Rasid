/**
 * Platform billing read models — Billing Engine, Phase 6. Read-only, runs on the
 * `app_platform_admin` connection (broad cross-tenant read, same as the existing
 * platform-admin reads). Two deterministic read models:
 *
 *  • loadPlatformBillingAttention — the triage queue (severity + age, no fuzzy
 *    scoring / AI). Sources: stale pending payments, latest-rejected-awaiting-
 *    retry, pending custom requests, offers near expiry, subscriptions expiring
 *    soon. (CAPACITY_AT_LIMIT is intentionally deferred — it needs a per-workspace
 *    usage aggregation the platform side does not yet compute.)
 *  • loadBillingReadinessDbChecks — the DB-derived half of launch readiness
 *    (migrations current, billing tables present, worker healthy, no DEAD
 *    outbox). The env-derived checks (payment channels, custom flows) are added
 *    by the API service, which owns env access. No secret is ever returned.
 */
import { sql } from "drizzle-orm";
import {
  BILLING_ATTENTION_KIND_SEVERITY,
  PAYMENT_PENDING_STALE_HOURS,
  capacityCtaTargetFor,
  compareBillingAttentionItems,
  platformBillingHistoryCategoryOf,
  resolvePlanLimits,
  type BillingAttentionItem,
  type BillingAttentionItemKind,
  type BillingPlanTier,
  type LaunchReadinessItem,
  type PlanCode,
  type PlatformBillingHistoryEventType,
  type PlatformBillingHistoryItem,
  type SubscriptionStateDto,
} from "@academic-precision/contracts";
import type { Db } from "./identity.repository";

function item(kind: BillingAttentionItemKind, over: Omit<BillingAttentionItem, "kind" | "severity">): BillingAttentionItem {
  return { kind, severity: BILLING_ATTENTION_KIND_SEVERITY[kind], ...over };
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

export async function loadPlatformBillingAttention(adminDb: Db, now: Date = new Date()): Promise<BillingAttentionItem[]> {
  const nowIso = now.toISOString();
  const items: BillingAttentionItem[] = [];

  // 1. Stale PENDING payments (older than the stale threshold, not yet expired).
  const stale = (await adminDb.execute(sql`
    SELECT pr.id, pr.human_code, pr.created_at, w.id AS workspace_id, w.name
    FROM payment_requests pr JOIN workspaces w ON w.id = pr.workspace_id
    WHERE pr.status = 'PENDING'
      AND pr.created_at < ${nowIso}::timestamptz - (${PAYMENT_PENDING_STALE_HOURS} || ' hours')::interval
      AND (pr.expires_at IS NULL OR pr.expires_at > ${nowIso}::timestamptz)
    ORDER BY pr.created_at ASC LIMIT 100
  `)) as unknown as Array<Record<string, unknown>>;
  for (const r of stale) {
    items.push(item("PAYMENT_PENDING_STALE", { workspaceId: String(r.workspace_id), workspaceName: (r.name as string) ?? null, title: `دفعة معلّقة منذ أكثر من ${PAYMENT_PENDING_STALE_HOURS} ساعة (${r.human_code})`, since: iso(r.created_at), target: "payment-requests", entityId: String(r.id) }));
  }

  // 2. Latest payment request per workspace is REJECTED → awaiting retry.
  const rejected = (await adminDb.execute(sql`
    SELECT pr.id, pr.human_code, pr.created_at, w.id AS workspace_id, w.name
    FROM payment_requests pr JOIN workspaces w ON w.id = pr.workspace_id
    WHERE pr.status = 'REJECTED'
      AND NOT EXISTS (SELECT 1 FROM payment_requests r2 WHERE r2.workspace_id = pr.workspace_id AND r2.created_at > pr.created_at)
    ORDER BY pr.created_at ASC LIMIT 100
  `)) as unknown as Array<Record<string, unknown>>;
  for (const r of rejected) {
    items.push(item("PAYMENT_REJECTED_AWAITING_RETRY", { workspaceId: String(r.workspace_id), workspaceName: (r.name as string) ?? null, title: `طلب دفع مرفوض بانتظار إعادة المحاولة (${r.human_code})`, since: iso(r.created_at), target: "payment-requests", entityId: String(r.id) }));
  }

  // 3. Pending custom requests.
  const requests = (await adminDb.execute(sql`
    SELECT cr.id, cr.created_at, w.id AS workspace_id, w.name
    FROM custom_plan_requests cr JOIN workspaces w ON w.id = cr.workspace_id
    WHERE cr.status = 'PENDING_REVIEW'
    ORDER BY cr.created_at ASC LIMIT 100
  `)) as unknown as Array<Record<string, unknown>>;
  for (const r of requests) {
    items.push(item("CUSTOM_REQUEST_PENDING", { workspaceId: String(r.workspace_id), workspaceName: (r.name as string) ?? null, title: "طلب باقة مخصّصة بانتظار المراجعة", since: iso(r.created_at), target: "custom-plans", entityId: String(r.id) }));
  }

  // 4. Custom offers near expiry (PENDING_CUSTOMER, valid_until within 3 days).
  const offers = (await adminDb.execute(sql`
    SELECT o.id, o.valid_until, w.id AS workspace_id, w.name
    FROM custom_plan_offers o JOIN workspaces w ON w.id = o.workspace_id
    WHERE o.status = 'PENDING_CUSTOMER'
      AND o.valid_until > ${nowIso}::timestamptz
      AND o.valid_until <= ${nowIso}::timestamptz + interval '3 days'
    ORDER BY o.valid_until ASC LIMIT 100
  `)) as unknown as Array<Record<string, unknown>>;
  for (const r of offers) {
    items.push(item("CUSTOM_OFFER_NEAR_EXPIRY", { workspaceId: String(r.workspace_id), workspaceName: (r.name as string) ?? null, title: "عرض باقة مخصّصة يوشك على الانتهاء", since: iso(r.valid_until), target: "custom-plans", entityId: String(r.id) }));
  }

  // 5. Subscriptions expiring soon (period_end within 7 days = not prepaid beyond).
  const subs = (await adminDb.execute(sql`
    SELECT s.id, s.period_end, s.state, w.id AS workspace_id, w.name
    FROM subscriptions s JOIN workspaces w ON w.id = s.workspace_id
    WHERE s.state IN ('TRIAL', 'ACTIVE', 'CANCELLED_AT_PERIOD_END')
      AND s.period_end > ${nowIso}::timestamptz
      AND s.period_end <= ${nowIso}::timestamptz + interval '7 days'
      AND w.status <> 'ARCHIVED'
    ORDER BY s.period_end ASC LIMIT 100
  `)) as unknown as Array<Record<string, unknown>>;
  for (const r of subs) {
    const trial = r.state === "TRIAL";
    items.push(item("SUBSCRIPTION_EXPIRING_SOON", { workspaceId: String(r.workspace_id), workspaceName: (r.name as string) ?? null, title: trial ? "فترة تجريبية توشك على الانتهاء" : "اشتراك يوشك على الانتهاء", since: iso(r.period_end), target: "subscriptions", entityId: String(r.id) }));
  }

  // 6. Capacity at 100% (students / team). Bounded, GROUPED aggregations (one row
  //    per active workspace) — NOT a per-row N+1 scan. Student usage is scoped to
  //    the CURRENT operating month (partial-unique index) + ACTIVE enrollments;
  //    team usage counts ACTIVE non-owner memberships.
  const studentUsage = new Map<string, number>();
  for (const row of (await adminDb.execute(sql`
    SELECT o.workspace_id AS ws, count(DISTINCT e.student_id)::int AS usage
    FROM operating_months o
    JOIN group_months gm ON gm.operating_month_id = o.id
    JOIN enrollments e ON e.group_month_id = gm.id AND e.status = 'ACTIVE'
    WHERE o.status = 'CURRENT'
    GROUP BY o.workspace_id
  `)) as unknown as Array<{ ws: string; usage: number }>) {
    studentUsage.set(String(row.ws), Number(row.usage));
  }
  const teamUsage = new Map<string, number>();
  for (const row of (await adminDb.execute(sql`
    SELECT m.workspace_id AS ws, count(*)::int AS usage
    FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
    WHERE m.status = 'ACTIVE' AND m.user_id <> w.owner_user_id
    GROUP BY m.workspace_id
  `)) as unknown as Array<{ ws: string; usage: number }>) {
    teamUsage.set(String(row.ws), Number(row.usage));
  }
  const capSubs = (await adminDb.execute(sql`
    SELECT s.id, s.workspace_id AS ws, s.state, s.plan_code, s.custom_max_active_students AS cmas, s.custom_max_team_members AS cmtm, w.name
    FROM subscriptions s JOIN workspaces w ON w.id = s.workspace_id
    WHERE s.state IN ('TRIAL', 'ACTIVE', 'EXPIRING') AND w.status <> 'ARCHIVED'
  `)) as unknown as Array<Record<string, unknown>>;
  for (const s of capSubs) {
    let limits: { maxActiveStudents: number; maxTeamMembers: number };
    try {
      limits = resolvePlanLimits({ subscriptionState: s.state as SubscriptionStateDto, planCode: (s.plan_code as PlanCode | null) ?? null, customMaxActiveStudents: s.cmas === null || s.cmas === undefined ? null : Number(s.cmas), customMaxTeamMembers: s.cmtm === null || s.cmtm === undefined ? null : Number(s.cmtm) });
    } catch {
      continue; // unmapped/legacy — no capacity signal
    }
    const wsId = String(s.ws);
    const tier: BillingPlanTier = s.plan_code === "CUSTOM" ? "CUSTOM" : s.plan_code === "BUSINESS_PLUS" ? "BUSINESS_PLUS" : "STANDARD";
    const planLabel = s.plan_code ? String(s.plan_code) : "TRIAL";
    const action = capacityCtaTargetFor(tier);
    const target = tier === "CUSTOM" ? "custom-plans" : "subscriptions";
    const students = studentUsage.get(wsId) ?? 0;
    if (limits.maxActiveStudents > 0 && students >= limits.maxActiveStudents) {
      items.push(item("CAPACITY_AT_LIMIT", { workspaceId: wsId, workspaceName: (s.name as string) ?? null, title: `بلغت مساحة العمل الحد الأقصى للطلاب (${students}/${limits.maxActiveStudents})`, since: now.toISOString(), target, entityId: String(s.id), resource: "STUDENTS", currentUsage: students, limit: limits.maxActiveStudents, currentPlan: planLabel, capacityAction: action }));
    }
    const team = teamUsage.get(wsId) ?? 0;
    if (limits.maxTeamMembers > 0 && team >= limits.maxTeamMembers) {
      items.push(item("CAPACITY_AT_LIMIT", { workspaceId: wsId, workspaceName: (s.name as string) ?? null, title: `بلغت مساحة العمل الحد الأقصى لأعضاء الفريق (${team}/${limits.maxTeamMembers})`, since: now.toISOString(), target, entityId: String(s.id), resource: "TEAM", currentUsage: team, limit: limits.maxTeamMembers, currentPlan: planLabel, capacityAction: action }));
    }
  }

  items.sort(compareBillingAttentionItems);
  return items;
}

/** The DB-derived launch-readiness checks (never a secret). The API service adds the env-derived checks. */
export async function loadBillingReadinessDbChecks(adminDb: Db): Promise<LaunchReadinessItem[]> {
  const checks: LaunchReadinessItem[] = [];

  // Billing tables present.
  const tables = ["subscriptions", "subscription_periods", "subscription_payments", "payment_requests", "custom_plan_requests", "custom_plan_offers", "notifications"];
  const present = (await adminDb.execute(sql`
    SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ANY(${sql.raw(`ARRAY[${tables.map((t) => `'${t}'`).join(",")}]`)})
  `)) as unknown as Array<{ n: number }>;
  const tablesOk = Number(present[0]?.n ?? 0) === tables.length;
  checks.push({ check: "BILLING_TABLES_PRESENT", ok: tablesOk, detail: tablesOk ? "كل جداول الفوترة موجودة" : "بعض جداول الفوترة غير موجودة" });

  // Migrations current (through 0070): its sweep index exists.
  const idx = (await adminDb.execute(sql`SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'payment_requests_status_expires_at_idx'`)) as unknown as Array<{ n: number }>;
  const migOk = Number(idx[0]?.n ?? 0) === 1;
  checks.push({ check: "MIGRATIONS_CURRENT", ok: migOk, detail: migOk ? "الهجرات محدّثة حتى 0070" : "هجرة 0070 غير مطبّقة بعد" });

  // Outbox health.
  const dead = (await adminDb.execute(sql`SELECT count(*)::int AS n FROM outbox_events WHERE status = 'DEAD'`)) as unknown as Array<{ n: number }>;
  const deadCount = Number(dead[0]?.n ?? 0);
  checks.push({ check: "NO_DEAD_OUTBOX", ok: deadCount === 0, detail: deadCount === 0 ? "لا أحداث outbox ميتة" : `${deadCount} حدث outbox ميت` });

  // Worker not wedged (no PROCESSING lease older than 10 minutes).
  const wedged = (await adminDb.execute(sql`SELECT count(*)::int AS n FROM outbox_events WHERE status = 'PROCESSING' AND available_at < now() - interval '10 minutes'`)) as unknown as Array<{ n: number }>;
  const wedgedCount = Number(wedged[0]?.n ?? 0);
  checks.push({ check: "WORKER_HEALTHY", ok: wedgedCount === 0, detail: wedgedCount === 0 ? "العامل يعمل دون تعطّل" : "أحداث معالجة عالقة — راجع العامل" });

  return checks;
}

// ---------------------------------------------------------------------------
// Platform billing history — a curated, cross-customer commercial timeline.
// Built from DOMAIN tables (full control over exposure) + a SAFE audit read for
// downgrade scheduled/cancelled only (after_json is just a plan code). NEVER
// returns raw audit JSON, a recommendation, an adjustment reason, a commercial
// note, or a reject reason — only curated Arabic titles + safe scalars (plan,
// amount, RSD human code). Bounded per source, then merged / sorted / cursor-paged.
// ---------------------------------------------------------------------------
const HISTORY_SOURCE_WINDOW = 200;

function paymentActionType(actionType: string): { type: PlatformBillingHistoryEventType; title: string } {
  if (actionType === "UPGRADE") return { type: "PLAN_UPGRADED", title: "ترقية الباقة (دفع مؤكَّد)" };
  if (actionType === "RENEWAL") return { type: "RENEWAL", title: "تجديد الاشتراك (دفع مؤكَّد)" };
  return { type: "SUBSCRIPTION_ACTIVATED", title: "تفعيل الاشتراك (دفع مؤكَّد)" };
}

export interface PlatformBillingHistoryPage {
  items: PlatformBillingHistoryItem[];
  page: { nextCursor: string | null; hasNext: boolean };
}

export async function loadPlatformBillingHistory(
  adminDb: Db,
  input: { workspaceId?: string | null; category?: string | null; cursor?: string | null; limit?: number },
): Promise<PlatformBillingHistoryPage> {
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
  const cursorMs = input.cursor ? Number(input.cursor) : null;
  const cutoffMs = cursorMs !== null && Number.isFinite(cursorMs) ? cursorMs : null;
  const wsId = input.workspaceId ?? null;
  const events: PlatformBillingHistoryItem[] = [];
  const push = (type: PlatformBillingHistoryEventType, over: Omit<PlatformBillingHistoryItem, "type" | "category">) =>
    events.push({ type, category: platformBillingHistoryCategoryOf(type), ...over });

  const pays = (await adminDb.execute(sql`
    SELECT sp.confirmed_at AS occurred_at, sp.amount_minor, sp.currency_code, pr.target_plan_code, pr.action_type, pr.human_code, w.id AS ws, w.name
    FROM subscription_payments sp JOIN payment_requests pr ON pr.id = sp.payment_request_id JOIN workspaces w ON w.id = sp.workspace_id
    ${wsId ? sql`WHERE sp.workspace_id = ${wsId}` : sql``}
    ORDER BY sp.confirmed_at DESC LIMIT ${HISTORY_SOURCE_WINDOW}
  `)) as unknown as Array<Record<string, unknown>>;
  for (const p of pays) {
    const k = paymentActionType(String(p.action_type));
    push(k.type, { occurredAt: iso(p.occurred_at), workspaceId: String(p.ws), workspaceName: (p.name as string) ?? null, title: k.title, planCode: (p.target_plan_code as string) ?? null, amountMinor: Number(p.amount_minor), currencyCode: (p.currency_code as string) ?? null, reference: (p.human_code as string) ?? null });
  }

  const reqs = (await adminDb.execute(sql`
    SELECT pr.created_at AS occurred_at, pr.amount_minor, pr.currency_code, pr.target_plan_code, pr.human_code, pr.status, w.id AS ws, w.name
    FROM payment_requests pr JOIN workspaces w ON w.id = pr.workspace_id
    ${wsId ? sql`WHERE pr.workspace_id = ${wsId}` : sql``}
    ORDER BY pr.created_at DESC LIMIT ${HISTORY_SOURCE_WINDOW}
  `)) as unknown as Array<Record<string, unknown>>;
  for (const r of reqs) {
    push("PAYMENT_REQUEST_CREATED", { occurredAt: iso(r.occurred_at), workspaceId: String(r.ws), workspaceName: (r.name as string) ?? null, title: "إنشاء طلب دفع", planCode: (r.target_plan_code as string) ?? null, amountMinor: Number(r.amount_minor), currencyCode: (r.currency_code as string) ?? null, reference: (r.human_code as string) ?? null });
    if (r.status === "REJECTED") push("PAYMENT_REJECTED", { occurredAt: iso(r.occurred_at), workspaceId: String(r.ws), workspaceName: (r.name as string) ?? null, title: "رفض طلب الدفع", planCode: (r.target_plan_code as string) ?? null, amountMinor: null, currencyCode: null, reference: (r.human_code as string) ?? null });
  }

  const revs = (await adminDb.execute(sql`
    SELECT rv.reversed_at AS occurred_at, w.id AS ws, w.name
    FROM subscription_payment_reversals rv JOIN workspaces w ON w.id = rv.workspace_id
    ${wsId ? sql`WHERE rv.workspace_id = ${wsId}` : sql``}
    ORDER BY rv.reversed_at DESC LIMIT ${HISTORY_SOURCE_WINDOW}
  `)) as unknown as Array<Record<string, unknown>>;
  for (const r of revs) push("PAYMENT_REVERSED", { occurredAt: iso(r.occurred_at), workspaceId: String(r.ws), workspaceName: (r.name as string) ?? null, title: "عكس دفعة", planCode: null, amountMinor: null, currencyCode: null, reference: null });

  const creqs = (await adminDb.execute(sql`
    SELECT cr.created_at AS occurred_at, w.id AS ws, w.name
    FROM custom_plan_requests cr JOIN workspaces w ON w.id = cr.workspace_id
    ${wsId ? sql`WHERE cr.workspace_id = ${wsId}` : sql``}
    ORDER BY cr.created_at DESC LIMIT ${HISTORY_SOURCE_WINDOW}
  `)) as unknown as Array<Record<string, unknown>>;
  for (const r of creqs) push("CUSTOM_REQUEST_CREATED", { occurredAt: iso(r.occurred_at), workspaceId: String(r.ws), workspaceName: (r.name as string) ?? null, title: "طلب باقة مخصّصة", planCode: "CUSTOM", amountMinor: null, currencyCode: null, reference: null });

  const offs = (await adminDb.execute(sql`
    SELECT o.created_at, o.accepted_at, o.status, o.price_minor, o.currency_code, w.id AS ws, w.name
    FROM custom_plan_offers o JOIN workspaces w ON w.id = o.workspace_id
    ${wsId ? sql`WHERE o.workspace_id = ${wsId}` : sql``}
    ORDER BY o.created_at DESC LIMIT ${HISTORY_SOURCE_WINDOW}
  `)) as unknown as Array<Record<string, unknown>>;
  for (const o of offs) {
    const ws = String(o.ws);
    const name = (o.name as string) ?? null;
    const price = Number(o.price_minor);
    const cur = (o.currency_code as string) ?? null;
    push("CUSTOM_OFFER_CREATED", { occurredAt: iso(o.created_at), workspaceId: ws, workspaceName: name, title: "إنشاء عرض مخصّص", planCode: "CUSTOM", amountMinor: price, currencyCode: cur, reference: null });
    if (o.status === "SUPERSEDED") push("CUSTOM_OFFER_SUPERSEDED", { occurredAt: iso(o.created_at), workspaceId: ws, workspaceName: name, title: "استبدال عرض مخصّص بإصدار أحدث", planCode: "CUSTOM", amountMinor: null, currencyCode: null, reference: null });
    if (o.accepted_at && (o.status === "ACCEPTED" || o.status === "APPLIED")) push("CUSTOM_OFFER_ACCEPTED", { occurredAt: iso(o.accepted_at), workspaceId: ws, workspaceName: name, title: "قبول عرض مخصّص", planCode: "CUSTOM", amountMinor: price, currencyCode: cur, reference: null });
    if (o.accepted_at && o.status === "APPLIED") push("CUSTOM_OFFER_APPLIED", { occurredAt: iso(o.accepted_at), workspaceId: ws, workspaceName: name, title: "تفعيل باقة مخصّصة", planCode: "CUSTOM", amountMinor: price, currencyCode: cur, reference: null });
  }

  const dg = (await adminDb.execute(sql`
    SELECT a.created_at AS occurred_at, a.action, a.after_json->>'pendingPlanCode' AS plan, w.id AS ws, w.name
    FROM audit_events a JOIN workspaces w ON w.id = a.workspace_id
    WHERE a.action IN ('billing.downgrade.scheduled', 'billing.downgrade.cancelled')
    ${wsId ? sql`AND a.workspace_id = ${wsId}` : sql``}
    ORDER BY a.created_at DESC LIMIT ${HISTORY_SOURCE_WINDOW}
  `)) as unknown as Array<Record<string, unknown>>;
  for (const d of dg) {
    const scheduled = d.action === "billing.downgrade.scheduled";
    push(scheduled ? "DOWNGRADE_SCHEDULED" : "DOWNGRADE_CANCELLED", { occurredAt: iso(d.occurred_at), workspaceId: String(d.ws), workspaceName: (d.name as string) ?? null, title: scheduled ? "جدولة خفض الباقة عند التجديد" : "إلغاء خفض مجدول", planCode: (d.plan as string) ?? null, amountMinor: null, currencyCode: null, reference: null });
  }

  let merged = events;
  if (input.category) merged = merged.filter((e) => e.category === input.category);
  if (cutoffMs !== null) merged = merged.filter((e) => new Date(e.occurredAt).getTime() < cutoffMs);
  merged.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  const pageItems = merged.slice(0, limit);
  const hasNext = merged.length > limit;
  const nextCursor = hasNext && pageItems.length > 0 ? String(new Date(pageItems[pageItems.length - 1]!.occurredAt).getTime()) : null;
  return { items: pageItems, page: { nextCursor, hasNext } };
}
