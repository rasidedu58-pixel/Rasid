import { capacityThresholdDedupKey, type CapacityThresholdBand } from "./billing-catalog";

/**
 * Billing lifecycle notifications — Billing Engine, Phase 6 (MONTHLY-only).
 *
 * The `notifications` table already carries a first-class `dedup_key` column
 * and a `UNIQUE(workspace_id, user_id, type, entity_type, entity_id,
 * dedup_key)` invariant, so every generator call is an
 * `INSERT ... ON CONFLICT DO NOTHING` — atomically idempotent under
 * concurrent/retried worker scans. Phase 6 adds new `type` values (migration
 * 0070 widens the CHECK) and centralises their Arabic copy + dedup-key schemes
 * here so the worker (emit side) and the web notification surface (read side)
 * share ONE vocabulary.
 *
 * Delivery model (V1): in-app notifications only — no email/SMS/WhatsApp
 * automation. WhatsApp stays a manual payment-proof deeplink.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Pre-Phase-6 types already in the DB CHECK — kept valid so historical rows never violate the widened constraint. `SUBSCRIPTION_EXPIRING` is superseded by `TRIAL_ENDING`/`SUBSCRIPTION_ENDING` for NEW emissions but stays readable. */
export const LEGACY_NOTIFICATION_TYPES = ["SUBSCRIPTION_EXPIRING", "FOLLOWUP_DUE", "MISSING_RECORDS"] as const;

/** Customer-facing billing notification types (Phase 6). */
export const CUSTOMER_BILLING_NOTIFICATION_TYPES = [
  "TRIAL_ENDING",
  "TRIAL_EXPIRED",
  "SUBSCRIPTION_ENDING",
  "SUBSCRIPTION_EXPIRED",
  "PAYMENT_REQUEST_CREATED",
  "PAYMENT_REQUEST_EXPIRING",
  "PAYMENT_REQUEST_EXPIRED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_REJECTED",
  "CAPACITY_STUDENTS",
  "CAPACITY_TEAM",
  "CUSTOM_OFFER_READY",
  "CUSTOM_OFFER_EXPIRING",
  "CUSTOM_OFFER_ACCEPTED_PAYMENT_PENDING",
  "CUSTOM_OFFER_APPLIED",
] as const;

/** Platform-admin-facing billing notification types (Phase 6). */
export const PLATFORM_BILLING_NOTIFICATION_TYPES = ["CUSTOM_REQUEST_CREATED", "NEW_PAYMENT_PROOF_PENDING"] as const;

/**
 * Team lifecycle notification types. `TEAM_INVITE_ACCEPTED` is the only one so
 * far: the owner shares an invitation link and otherwise learns that it was
 * used by noticing a new row on the team page. Migration 0077 widens the
 * `notifications_type_check` for it.
 */
export const TEAM_NOTIFICATION_TYPES = ["TEAM_INVITE_ACCEPTED"] as const;
export type TeamNotificationType = (typeof TEAM_NOTIFICATION_TYPES)[number];

export const BILLING_NOTIFICATION_TYPES = [
  ...CUSTOMER_BILLING_NOTIFICATION_TYPES,
  ...PLATFORM_BILLING_NOTIFICATION_TYPES,
] as const;
export type BillingNotificationType = (typeof BILLING_NOTIFICATION_TYPES)[number];

/** The full set of values the `notifications_type_check` CHECK must permit (legacy + billing) — the source of truth for migration 0070. */
export const ALL_NOTIFICATION_TYPES = [...LEGACY_NOTIFICATION_TYPES, ...BILLING_NOTIFICATION_TYPES, ...TEAM_NOTIFICATION_TYPES] as const;
export type NotificationTypeValue = (typeof ALL_NOTIFICATION_TYPES)[number];

const PLATFORM_SET: ReadonlySet<string> = new Set(PLATFORM_BILLING_NOTIFICATION_TYPES);
/** Which side a billing notification is addressed to. Platform types go to platform staff, never to the tenant. */
export function billingNotificationAudience(type: BillingNotificationType): "CUSTOMER" | "PLATFORM" {
  return PLATFORM_SET.has(type) ? "PLATFORM" : "CUSTOMER";
}

// ---------------------------------------------------------------------------
// Dedup keys
// ---------------------------------------------------------------------------

/** Reminder milestones (days before an end date) for TRIAL/SUBSCRIPTION endings. */
export const LIFECYCLE_REMINDER_MILESTONES = [7, 3, 1] as const;
export type LifecycleReminderMilestone = (typeof LIFECYCLE_REMINDER_MILESTONES)[number];
/** Reminder milestones for a custom offer nearing `valid_until`. */
export const OFFER_REMINDER_MILESTONES = [3, 1] as const;
export type OfferReminderMilestone = (typeof OFFER_REMINDER_MILESTONES)[number];

/** `7d` | `3d` | `1d` — one notification row per crossed milestone per end date. */
export function reminderMilestoneDedupKey(days: number): string {
  return `${days}d`;
}
/** A terminal (expired) lifecycle notification is deduped per the period it ends — the aggregate `period_end` epoch ms — so a later renewed period can notify again. */
export function lifecycleTerminalDedupKey(periodEndMs: number): string {
  return `end:${periodEndMs}`;
}
/** A payment-request created/expired notification is deduped by the request id (one per request). */
export function paymentRequestDedupKey(paymentRequestId: string): string {
  return paymentRequestId;
}
/** A payment-request-expiring warning fires once (24h before expiry) per request. */
export function paymentRequestExpiringDedupKey(paymentRequestId: string): string {
  return `${paymentRequestId}:24h`;
}
/** A custom-offer lifecycle notification (ready/accepted/applied) is deduped by offer id. */
export function customOfferDedupKey(offerId: string): string {
  return offerId;
}
/** A custom-offer-expiring warning is deduped by offer id + milestone. */
export function customOfferExpiringDedupKey(offerId: string, days: number): string {
  return `${offerId}:${days}d`;
}
/**
 * A team-invite-accepted notification is deduped by the MEMBERSHIP id — the row
 * that proves the person actually joined. The membership is created once, in
 * the same transaction as the invitation's PENDING → ACCEPTED flip, so a
 * retried/reclaimed outbox event can never produce a second notification and a
 * failed or revoked invitation produces none at all.
 */
export function teamInviteAcceptedDedupKey(membershipId: string): string {
  return membershipId;
}
/** A new-payment-proof notification to platform staff is deduped by the request id — one per request per staff member. */
export function paymentProofPendingDedupKey(paymentRequestId: string): string {
  return paymentRequestId;
}
/** Re-export the catalog capacity dedup key so the emit side imports one module. */
export { capacityThresholdDedupKey };

// ---------------------------------------------------------------------------
// Copy (Arabic) — centralised, pure, unit-testable. MONTHLY-only (no annual wording).
// ---------------------------------------------------------------------------

export interface NotificationContent {
  title: string;
  body: string;
}

const dayWord = (days: number): string => (days === 1 ? "يوم" : days === 2 ? "يومين" : days <= 10 ? "أيام" : "يومًا");

/** EGP display from integer piastres. Whole pounds show no decimals. */
export function formatEgpMinor(minor: number): string {
  const pounds = minor / 100;
  const text = Number.isInteger(pounds) ? String(pounds) : pounds.toFixed(2);
  return `${text} ج.م`;
}

export function trialEndingContent(workspaceName: string, days: number): NotificationContent {
  return {
    title: "اقتراب انتهاء الفترة التجريبية",
    body: `تنتهي الفترة التجريبية لمساحة العمل «${workspaceName}» خلال ${days} ${dayWord(days)}. فعّل اشتراكك الشهري للاستمرار دون انقطاع.`,
  };
}
export function trialExpiredContent(workspaceName: string): NotificationContent {
  return { title: "انتهت الفترة التجريبية", body: `انتهت الفترة التجريبية لمساحة العمل «${workspaceName}». بياناتك محفوظة — فعّل اشتراكًا لاستئناف العمليات.` };
}
export function subscriptionEndingContent(workspaceName: string, days: number): NotificationContent {
  return { title: "اقتراب انتهاء الاشتراك", body: `ينتهي اشتراك مساحة العمل «${workspaceName}» خلال ${days} ${dayWord(days)}. جدّد الآن لتفادي أي انقطاع.` };
}
export function subscriptionExpiredContent(workspaceName: string): NotificationContent {
  return { title: "انتهى الاشتراك", body: `انتهى اشتراك مساحة العمل «${workspaceName}». بياناتك وتقاريرك محفوظة — جدّد لاستئناف العمليات المدفوعة.` };
}
export function paymentRequestCreatedContent(humanCode: string, amountMinor: number): NotificationContent {
  return { title: "تم إنشاء طلب دفع", body: `طلب الدفع ${humanCode} بقيمة ${formatEgpMinor(amountMinor)} بانتظار إتمامه. أكمل التحويل وأرسل الإثبات عبر واتساب.` };
}
export function paymentRequestExpiringContent(humanCode: string): NotificationContent {
  return { title: "طلب الدفع يوشك على الانتهاء", body: `طلب الدفع ${humanCode} تنتهي صلاحيته خلال 24 ساعة. أكمله أو أنشئ طلبًا جديدًا.` };
}
export function paymentRequestExpiredContent(humanCode: string): NotificationContent {
  return { title: "انتهت صلاحية طلب الدفع", body: `انتهت صلاحية طلب الدفع ${humanCode}. أنشئ طلبًا جديدًا للمتابعة.` };
}
export function paymentConfirmedContent(humanCode: string): NotificationContent {
  return { title: "تم تأكيد الدفع", body: `تم تأكيد الدفع لطلب ${humanCode} وتفعيل اشتراكك.` };
}
export function paymentRejectedContent(humanCode: string, safeReason: string | null): NotificationContent {
  const tail = safeReason && safeReason.trim().length > 0 ? ` السبب: ${safeReason.trim()}.` : "";
  return { title: "تم رفض طلب الدفع", body: `تم رفض طلب الدفع ${humanCode}.${tail} يمكنك إنشاء طلب جديد.` };
}
export function capacityContent(kind: "STUDENTS" | "TEAM", band: CapacityThresholdBand): NotificationContent {
  const resource = kind === "STUDENTS" ? "الطلاب" : "أعضاء الفريق";
  if (band === 100) return { title: "بلغت الحد الأقصى للباقة", body: `وصلت إلى الحد الأقصى لعدد ${resource} في باقتك. للاستمرار في الإضافة، رقِّ باقتك أو اطلب باقة مخصصة.` };
  return { title: "اقتراب الحد الأقصى للباقة", body: `اقتربت من الحد الأقصى لعدد ${resource} في باقتك (${band}%).` };
}
export function customOfferReadyContent(): NotificationContent {
  return { title: "عرض باقة مخصّصة جاهز", body: "أصبح لديك عرض باقة مخصّصة جاهز للمراجعة. اطّلع عليه لقبوله أو رفضه." };
}
export function customOfferExpiringContent(days: number): NotificationContent {
  return { title: "عرض الباقة المخصّصة يوشك على الانتهاء", body: `تنتهي صلاحية عرض باقتك المخصّصة خلال ${days} ${dayWord(days)}. راجعه قبل انتهائه.` };
}
export function customOfferAcceptedPaymentPendingContent(): NotificationContent {
  return { title: "بانتظار دفع الباقة المخصّصة", body: "قبلت عرض الباقة المخصّصة — أكمل الدفع لتفعيلها." };
}
export function customOfferAppliedContent(): NotificationContent {
  return { title: "تم تفعيل الباقة المخصّصة", body: "تم تفعيل باقتك المخصّصة بنجاح." };
}
// Platform-facing
export function customRequestCreatedContent(workspaceName: string): NotificationContent {
  return { title: "طلب باقة مخصّصة جديد", body: `طلبت مساحة العمل «${workspaceName}» باقة مخصّصة وتنتظر المراجعة.` };
}
/**
 * Platform staff: a brand-new payment request needs review. Names WHO asked,
 * WHICH plan and HOW MUCH, because a staff member triaging a queue should not
 * have to open the row to learn what it is.
 */
export function newPaymentProofPendingContent(input: {
  humanCode: string;
  workspaceName: string;
  requesterName: string | null;
  planName: string;
  amountMinor: number;
}): NotificationContent {
  // The workspace is always named: staff triage BY workspace, and a bare
  // person's name does not say which customer the request belongs to.
  const name = input.requesterName?.trim();
  const who = name && name !== input.workspaceName ? `${name} (${input.workspaceName})` : input.workspaceName;
  return {
    title: "طلب دفع جديد يحتاج مراجعة",
    body: `${who} — ${input.planName} — ${formatEgpMinor(input.amountMinor)} (كود ${input.humanCode}).`,
  };
}

/** The workspace owner (or whoever created the invitation): someone used it and is now a member. */
export function teamInviteAcceptedContent(memberName: string | null, workspaceName: string): NotificationContent {
  const who = memberName && memberName.trim().length > 0 ? memberName.trim() : "عضو جديد";
  return { title: "تم انضمام عضو جديد للفريق", body: `${who} انضم إلى مساحة العمل «${workspaceName}».` };
}

// The in-app notification READ surface (list/mark-read DTOs) already lives in
// `reports.ts` (`NotificationDto`, `listNotificationsResponseSchema`, …) and is
// reused verbatim — Phase 6 only adds new `type` values + copy, not a new DTO.
