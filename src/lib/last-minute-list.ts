import { randomBytes } from "node:crypto";
import { isValidPromoDiscountAmountCents, type PromoDiscount } from "./promo-codes";

/**
 * Fill-the-boat promo logic: the discount's bounds and the code text a diver
 * types at booking. Framework-free (docs ADR 20260727-last-minute-fill-promos);
 * the Stripe coupon/promotion-code calls live in src/lib/payments/promotions.ts.
 * Who a deal reaches (the anytime leads) is `src/lib/leads.ts`.
 */

/** Discount bounds mirrored from the `trip_last_minute_promos_discount_range` check constraint. */
export const LAST_MINUTE_DISCOUNT_MIN = 5;
export const LAST_MINUTE_DISCOUNT_MAX = 90;

export function isValidLastMinuteDiscountPercent(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= LAST_MINUTE_DISCOUNT_MIN &&
    value <= LAST_MINUTE_DISCOUNT_MAX
  );
}

/**
 * A short, typeable code — "SAVE50-A1B2C3" — unique enough that a random
 * 6-hex-char suffix collision is astronomically unlikely; the shop-scoped
 * unique index is the actual backstop on retry. Uppercase only: Stripe
 * promotion codes are case-sensitive and divers reliably fat-finger case.
 */
export function generateLastMinutePromoCode(discountPercent: number): string {
  const suffix = randomBytes(3).toString("hex").toUpperCase();
  return `SAVE${discountPercent}-${suffix}`;
}

/**
 * The one discount an offer asks for, or null when it asks for none, both, or
 * one out of range: a percent held to the shop's 5–90 bounds, or a fixed amount
 * in minor units above zero.
 */
export function lastMinuteDealDiscount(input: {
  discountPercent?: number | null;
  discountAmountCents?: number | null;
}): PromoDiscount | null {
  const percent = input.discountPercent ?? null;
  const amount = input.discountAmountCents ?? null;
  if ((percent === null) === (amount === null)) return null;
  if (percent !== null) {
    return isValidLastMinuteDiscountPercent(percent) ? { kind: "percent", percent } : null;
  }
  return isValidPromoDiscountAmountCents(amount) ? { kind: "amount", amountCents: amount } : null;
}
