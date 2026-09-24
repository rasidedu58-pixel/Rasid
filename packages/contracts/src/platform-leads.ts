import { z } from "zod";
import { cursorPageSchema } from "./pagination";

/**
 * Rasid Platform Leads — Phase 16 Part B. Every NEW self-service signup (a
 * brand-new Owner + Workspace) surfaces here as a lead the Rasid team can
 * follow up on. Intentionally a SMALL follow-up ledger, not a full CRM.
 *
 * The lead ROW (platform_leads) stores only follow-up state — status, contact
 * / follow-up dates, a free note. Identity fields (name / phone / email) are
 * NOT stored on the lead; they are read live from `users` via the owner and
 * carried on the DTO below purely for display. Likewise the subscription hint
 * (`subscriptionState` / `trialEndsAt`) is derived at read time — it never
 * flips `status` (CONVERTED stays a manual action in V1).
 */

// --- Status -----------------------------------------------------------------
export const PLATFORM_LEAD_STATUSES = [
  "NEW", // just signed up, not yet contacted
  "CONTACTED", // reached out at least once
  "FOLLOW_UP", // needs another touch (usually with next_follow_up_at set)
  "POSTPONED", // deferred to later
  "CONVERTED", // became a paying customer (manual in V1)
  "NOT_INTERESTED", // closed — declined / went cold
] as const;
export const platformLeadStatusSchema = z.enum(PLATFORM_LEAD_STATUSES);
export type PlatformLeadStatus = (typeof PLATFORM_LEAD_STATUSES)[number];

// --- Lead DTO ---------------------------------------------------------------
export const platformLeadSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  workspaceName: z.string().nullable(),
  ownerUserId: z.string().uuid(),
  // Live-joined display fields (NOT stored on the lead row).
  ownerName: z.string().nullable(),
  ownerPhone: z.string().nullable(),
  ownerEmail: z.string().nullable(),
  status: platformLeadStatusSchema,
  lastContactAt: z.string().nullable(),
  nextFollowUpAt: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  updatedByName: z.string().nullable(),
  // Derived subscription hint (display only — never auto-converts the lead).
  subscriptionState: z.string().nullable(),
  trialEndsAt: z.string().nullable(),
  hasActivePaidSubscription: z.boolean(),
});
export type PlatformLead = z.infer<typeof platformLeadSchema>;

export const listPlatformLeadsResponseSchema = cursorPageSchema(platformLeadSchema);
export type ListPlatformLeadsResponse = z.infer<typeof listPlatformLeadsResponseSchema>;

// --- Metrics (top strip) ----------------------------------------------------
export const platformLeadMetricsSchema = z.object({
  total: z.number().int().nonnegative(),
  newCount: z.number().int().nonnegative(), // status = NEW
  needsFollowUp: z.number().int().nonnegative(), // FOLLOW_UP or an overdue next_follow_up_at
  dueToday: z.number().int().nonnegative(), // next_follow_up_at falls today
  converted: z.number().int().nonnegative(), // status = CONVERTED
});
export type PlatformLeadMetrics = z.infer<typeof platformLeadMetricsSchema>;

// --- List query -------------------------------------------------------------
// `filter` is a small named set of curated views, not a raw status passthrough,
// so the UI tabs and the server stay in lockstep.
export const PLATFORM_LEAD_FILTERS = ["ALL", "NEW", "NEEDS_FOLLOW_UP", "POSTPONED", "CONTACTED", "CONVERTED"] as const;
export const platformLeadFilterSchema = z.enum(PLATFORM_LEAD_FILTERS);
export type PlatformLeadFilter = (typeof PLATFORM_LEAD_FILTERS)[number];

// --- Update request ---------------------------------------------------------
export const updatePlatformLeadRequestSchema = z
  .object({
    status: platformLeadStatusSchema.optional(),
    note: z.string().trim().max(2000).nullable().optional(),
    nextFollowUpAt: z.string().datetime().nullable().optional(),
    // When true, stamp last_contact_at = now (e.g. "I just called"). The
    // WhatsApp button opens a chat only; marking contact is an explicit act.
    markContactedNow: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.status !== undefined ||
      v.note !== undefined ||
      v.nextFollowUpAt !== undefined ||
      v.markContactedNow === true,
    { message: "لا يوجد تغيير" },
  );
export type UpdatePlatformLeadRequest = z.infer<typeof updatePlatformLeadRequestSchema>;

// --- WhatsApp deep-link (pure, shared, testable) ----------------------------
/**
 * Normalize a raw phone into E.164 digits (no leading `+`, no separators) for
 * a `wa.me` link. Egypt-first defaults, but tolerant of already-international
 * inputs:
 *   - strips spaces / dashes / parens / a leading `+` or `00`
 *   - a leading `0` national number (e.g. 01012345678) → country code 20
 *   - a bare 10-digit mobile (1012345678) → 20-prefixed
 * Returns `null` when there aren't enough digits to be a real number, so the
 * caller can hide the button rather than build a broken link.
 */
export function normalizeWhatsappPhone(raw: string | null | undefined, defaultCountryCode = "20"): string | null {
  if (!raw) return null;
  let digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  digits = digits.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith(defaultCountryCode) && digits.length >= 11) return digits;
  if (digits.startsWith("0")) digits = defaultCountryCode + digits.slice(1);
  else if (digits.length <= 10) digits = defaultCountryCode + digits;
  // Final sanity: a usable international number is at least ~10 digits.
  return digits.length >= 10 ? digits : null;
}

/**
 * Build a `wa.me` deep-link that OPENS a chat with a prefilled message. It
 * never sends anything — WhatsApp always shows the composed message for the
 * human to review and send. Returns `null` when the phone can't be normalized.
 */
export function buildWhatsappLink(rawPhone: string | null | undefined, message?: string): string | null {
  const phone = normalizeWhatsappPhone(rawPhone);
  if (!phone) return null;
  const base = `https://wa.me/${phone}`;
  return message && message.trim() ? `${base}?text=${encodeURIComponent(message.trim())}` : base;
}
