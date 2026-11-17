/**
 * **Wrapped up's Money card, as arithmetic** (ADR 20261117-trip-page-clock):
 * what one departure collected, what of it was rental gear, and what its
 * seats still owe, from each seat's current payment and price. Codes and
 * numbers only; the page says them.
 */

/** Payment states whose amount is money the shop holds (as Reports counts it). */
export const COLLECTED_STATUSES: ReadonlySet<string> = new Set([
  "paid",
  "deposit_paid",
  "partly_refunded",
]);

export type TripMoneySeat = {
  /** The seat is not cancelled (a no-show still owes what it owed). */
  live: boolean;
  /** Its current payment state, or null when nothing was ever recorded. */
  paymentStatus: string | null;
  /** What the shop holds for it now, in the payment's currency. */
  amountCents: number | null;
  paymentCurrency: string | null;
  /** What it still owes (`seatBalanceOwedCents`), or null for nothing or no price. */
  owedCents: number | null;
  /**
   * Rental gear it paid for, net of refunds (`netOfRefund`): completed
   * checkouts' gear and paid rental order lines. A cancelled seat's is left out.
   */
  rentalCents: number;
};

export type TripMoney = {
  currency: string;
  collectedCents: number;
  rentalCents: number;
  /** Live seats whose guest paid for rental gear. */
  rentalGuests: number;
  owedCents: number;
  /** Seats whose money is in another currency, left out of the sums. */
  otherCurrencySeats: number;
};

export function tallyTripMoney(seats: readonly TripMoneySeat[], currency: string): TripMoney {
  const money: TripMoney = {
    currency,
    collectedCents: 0,
    rentalCents: 0,
    rentalGuests: 0,
    owedCents: 0,
    otherCurrencySeats: 0,
  };
  const ours = currency.toLowerCase();
  for (const seat of seats) {
    if (seat.paymentCurrency && seat.paymentCurrency.toLowerCase() !== ours) {
      money.otherCurrencySeats += 1;
      continue;
    }
    if (seat.paymentStatus && COLLECTED_STATUSES.has(seat.paymentStatus)) {
      money.collectedCents += Math.max(0, seat.amountCents ?? 0);
    }
    if (seat.live && seat.rentalCents > 0) {
      money.rentalCents += seat.rentalCents;
      money.rentalGuests += 1;
    }
    if (seat.live && seat.owedCents && seat.owedCents > 0) money.owedCents += seat.owedCents;
  }
  return money;
}

/**
 * What is left of `partCents` of a payment of `totalCents` once
 * `refundedCents` of it went back, in the share the part was of the whole: a
 * refund is recorded on the checkout or order, not on its gear.
 */
export function netOfRefund(partCents: number, totalCents: number, refundedCents: number): number {
  if (partCents <= 0 || totalCents <= 0) return 0;
  const kept = Math.max(0, totalCents - refundedCents);
  return Math.floor((partCents * kept) / totalCents);
}
