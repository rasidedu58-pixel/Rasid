/**
 * WhatsApp support channel — single source of truth for the number, the
 * pre-filled message, and the wa.me URL. Kept out of the components so the
 * copy stays consistent and swapping the number later touches ONE file.
 *
 * Number format:
 *  • WHATSAPP_NUMBER_E164_DIGITS — E.164 digits only (no "+"), the shape
 *    `wa.me/<digits>` expects.
 *  • WHATSAPP_NUMBER_DISPLAY_AR — natural Egyptian local reading for the UI,
 *    grouped `0122 795 8232`.
 *
 * The Egyptian mobile carrier prefix is stripped of its leading 0 and prefixed
 * with the country code 20 for the E.164 form — verified against WhatsApp's
 * own `wa.me` short-link contract (digits only, country code included).
 */
export const WHATSAPP_NUMBER_E164_DIGITS = "201227958232";
export const WHATSAPP_NUMBER_DISPLAY_AR = "0122 795 8232";

/** Pre-filled first message sent when the user opens WhatsApp from the site. */
export const WHATSAPP_INTENT_MESSAGE = "أريد معرفة المزيد عن راصد";

/**
 * Build the wa.me link. Pass a custom message to specialise a CTA (e.g. from
 * a specific page); the default intent covers the generic support entry.
 */
export function whatsappUrl(message: string = WHATSAPP_INTENT_MESSAGE): string {
  return `https://wa.me/${WHATSAPP_NUMBER_E164_DIGITS}?text=${encodeURIComponent(message)}`;
}
