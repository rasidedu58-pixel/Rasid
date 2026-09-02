/**
 * Best-effort wa.me deep link from a phone number — the single source of truth
 * for every "contact via WhatsApp" surface (guardian contact, platform-admin
 * customer/payment comms).
 *
 * WhatsApp needs the international number (country code, no leading 0). Teachers
 * usually store/enter an Egyptian local number like `01227958232`, which
 * WhatsApp rejects ("رمز الدولة غير صحيح"). So we normalize:
 *   - strip non-digits;
 *   - `00`-prefixed international → drop the `00`;
 *   - Egyptian local `0` + 11 digits → `20` + the rest (e.g. 01227958232 →
 *     201227958232);
 *   - anything else (already international, e.g. 20… or +20…) → used as-is.
 * Returns null when there aren't enough digits to be a real number.
 */
export function whatsappHref(phone: string | null | undefined, text?: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length < 8) return null;
  let intl = digits;
  if (digits.startsWith("00")) intl = digits.slice(2);
  else if (digits.startsWith("0") && digits.length === 11) intl = `20${digits.slice(1)}`;
  const query = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${intl}${query}`;
}
