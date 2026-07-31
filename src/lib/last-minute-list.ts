import { randomBytes } from "node:crypto";

/**
 * Fill-the-boat promo logic — matching last-minute-list entries to a
 * departing trip, and generating the code text a diver types at booking.
 * Framework-free (docs ADR 20260727-last-minute-fill-promos); the Stripe
 * coupon/promotion-code calls live in src/lib/payments/promotions.ts.
 */

export type LastMinuteListWindow = {
  /** Date-only (YYYY-MM-DD), or null for "no lower bound." */
  availableFrom: string | null;
  /** Date-only (YYYY-MM-DD), or null for "no upper bound." */
  availableUntil: string | null;
};

/**
 * True when a trip departing on `tripDateIso` (date-only, in the shop's own
 * timezone) falls inside the diver's stated window. Either bound absent means
 * unbounded on that side — a diver who gave no dates matches every trip.
 */
export function lastMinuteEntryMatchesTripDate(
  entry: LastMinuteListWindow,
  tripDateIso: string,
): boolean {
  if (entry.availableFrom && tripDateIso < entry.availableFrom) return false;
  if (entry.availableUntil && tripDateIso > entry.availableUntil) return false;
  return true;
}

/**
 * Puts a trip's own wait-listers first in a last-minute-deal recipient list,
 * in their wait-list order, ahead of everyone else who is merely around that
 * week. They hold "a place in line" for this exact trip that the deal can
 * otherwise sell out from under them — see backlog item 147 (reconcile the
 * wait list and the last-minute list). Anyone not on the wait list keeps
 * their original relative order (a stable sort).
 */
export function orderLastMinuteRecipients<T extends { person: { id: string } }>(
  matches: readonly T[],
  waitlistedPersonIds: readonly string[],
): T[] {
  const position = new Map(waitlistedPersonIds.map((id, index) => [id, index]));
  return [...matches].sort((a, b) => {
    const aPos = position.get(a.person.id);
    const bPos = position.get(b.person.id);
    if (aPos !== undefined && bPos !== undefined) return aPos - bPos;
    if (aPos !== undefined) return -1;
    if (bPos !== undefined) return 1;
    return 0;
  });
}

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
