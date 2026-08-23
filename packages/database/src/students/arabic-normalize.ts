/**
 * Arabic name normalization — Database Schema §13.1 ("Arabic normalization
 * rules"), API Contract §13 ("Search Contract — Arabic normalization").
 *
 * Pure, side-effect-free, unit-testable. Applied BOTH when writing
 * `students.search_name_normalized` at create/update time AND when
 * normalizing an incoming search query before matching (pg_trgm
 * similarity), so both sides of the comparison use the identical
 * transformation.
 *
 * Transformations (applied in this order):
 *  1. Alef variants (U+0622 madda-alef, U+0623 hamza-above-alef, U+0625
 *     hamza-below-alef) → U+0627 bare alef.
 *  2. U+0649 alef maksura → U+064A yeh.
 *  3. Strip tatweel (U+0640).
 *  4. Strip Arabic diacritics: harakat U+064B..U+065F, plus superscript
 *     alef U+0670. Written as two disjoint \\u-escaped ranges rather than
 *     one literal range between two Arabic characters, because a literal
 *     range like that can silently span further than intended and swallow
 *     the Arabic-Indic digit block (U+0660..U+0669) that step 5 needs
 *     intact — using explicit code points avoids that class of bug.
 *  5. Normalize Arabic-Indic digits (U+0660..U+0669) to Western digits
 *     (0-9). Direction chosen and documented here: Arabic-Indic → Western,
 *     applied consistently everywhere this function is used (not the
 *     reverse) — an implementation detail, not a product decision.
 *  6. Collapse runs of whitespace to a single space and trim.
 *
 * Deliberately does NOT lowercase (Arabic has no case) and does NOT touch
 * Latin characters beyond digit normalization.
 */

const ALEF_VARIANTS = /[آأإ]/g; // U+0622 آ, U+0623 أ, U+0625 إ
const ALEF_MAKSURA = /ى/g; // ى
const TATWEEL = /ـ/g; // ـ
const ARABIC_DIACRITICS = /[ً-ٰٟ]/g;
const ARABIC_INDIC_DIGITS = /[٠-٩]/g;
const WHITESPACE_RUN = /\s+/g;

function arabicIndicDigitToWestern(char: string): string {
  return String(char.charCodeAt(0) - 0x0660);
}

/** Normalizes a name (or search query) for Arabic-aware fuzzy matching. See module doc for the exact transformation list. */
export function normalizeArabicName(input: string): string {
  return input
    .replace(ALEF_VARIANTS, "ا") // bare alef
    .replace(ALEF_MAKSURA, "ي") // yeh
    .replace(TATWEEL, "")
    .replace(ARABIC_DIACRITICS, "")
    .replace(ARABIC_INDIC_DIGITS, arabicIndicDigitToWestern)
    .replace(WHITESPACE_RUN, " ")
    .trim();
}

/**
 * Normalizes a guardian phone number for exact/prefix matching
 * (`guardians.normalized_phone` — Database Schema §6.2). Strips everything
 * but digits (spaces, dashes, parentheses, a leading "+"), and converts
 * Arabic-Indic digits to Western first so Arabic-Indic and Western digit
 * strings of the same number normalize identically. Does not attempt
 * E.164/country-code canonicalization (out of scope — V1 shows possible
 * matches, never auto-merges).
 */
export function normalizePhone(input: string): string {
  return input.replace(ARABIC_INDIC_DIGITS, arabicIndicDigitToWestern).replace(/\D/g, "");
}
