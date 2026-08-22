/**
 * Minimal cross-cutting Money-adjacent primitive.
 *
 * This is intentionally NOT a full Money value object. Rounding rules,
 * arithmetic, currency conversion and other business behavior belong to the
 * Finance domain in a later phase. This type only fixes the representation
 * convention (integer minor units, never binary floating point) so no future
 * module invents a float-based amount.
 */
export type MoneyMinor = {
  readonly amountMinor: number;
  readonly currency: string;
};
