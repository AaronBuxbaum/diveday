/**
 * **How a shop takes money at the desk** (fifth-loop ideas, item 21). A seat
 * "due at the shop" told a visitor what they owe and not how to pay it, so a
 * diver who brought no cash met a card-only desk at 6:30 AM, or the other way
 * round. The shop says it once, in Settings > Dock-day rhythm, and the booking
 * form, the confirmation and `/ready` each add one sentence.
 *
 * Null on a shop that has not said: nothing is added, never a guess.
 * Codes here; the words are `src/i18n/desk-payment-labels.ts`'s.
 */
export const DESK_PAYMENTS = ["card", "cash", "card_and_cash"] as const;

export type DeskPayment = (typeof DESK_PAYMENTS)[number];

export function isDeskPayment(value: unknown): value is DeskPayment {
  return typeof value === "string" && (DESK_PAYMENTS as readonly string[]).includes(value);
}
