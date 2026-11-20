import { percentFeeCents } from "../../lib/billing/pricing-plans";

/**
 * **What a shop would pay each month on FareHarbor and on DiveDay, counted the same way**
 * (Aaron, 2026-11-18; one revenue base, Aaron, 2026-11-20). The `/pricing` comparison slider
 * is the money a shop takes for trips and courses in a month. Every figure is an
 * estimate for a reader to move, never a quote: the assumptions below are named
 * on the page beside the sources and the date each was checked.
 *
 * Both columns are a subscription, a percent of **all** of that money, and the same
 * card processing on top. Three of four write-ups say FareHarbor's percent is charged
 * with card processing on top (CaptainBook 2026-04-09, TrekkSoft 2026-06-30, Levy 2026),
 * and Aaron agrees. Online travel agency bookings are not modeled: their share is an
 * assumption that moved one column's base and not the other's. Amounts are USD cents.
 */
export const FEE_ASSUMPTIONS = {
  /** An average sale, which only the card processor's fixed part depends on. */
  averageSaleCents: 15_000,
  /** The published US rate for a domestic card, Stripe's 2.9% + 30¢ (stripe.com/pricing, 2026-11-18), for both columns. */
  cardBasisPoints: 290,
  cardFixedCents: 30,
  /** FareHarbor: no published schedule; third-party reports of ~6% of a booking, no monthly fee (2026). */
  fareHarborBasisPoints: 600,
} as const;

export const COMPARED_SYSTEMS = ["fareharbor", "diveday"] as const;
export type ComparedSystem = (typeof COMPARED_SYSTEMS)[number];

export type SystemCost = {
  system: ComparedSystem;
  /** The monthly subscription: nothing for FareHarbor, the offer's monthly fee for DiveDay. */
  subscriptionCents: number;
  /** The system's percent of the month's money. */
  bookingFeeCents: number;
  /** Card processing on the month's money. */
  processingCents: number;
  /** Everything above, for the month. */
  totalCents: number;
};

export type DiveDayTerms = { monthlyCents: number; basisPoints: number };

/** The month's money, every cent of it counted once in each column. */
export function compareMonth(receivedCents: number, diveDay: DiveDayTerms): readonly SystemCost[] {
  const received = Math.max(0, Math.round(receivedCents));
  const sales = Math.ceil(received / FEE_ASSUMPTIONS.averageSaleCents);
  const processingCents =
    percentFeeCents(received, FEE_ASSUMPTIONS.cardBasisPoints) +
    sales * FEE_ASSUMPTIONS.cardFixedCents;
  const row = (
    system: ComparedSystem,
    subscriptionCents: number,
    bookingFeeCents: number,
  ): SystemCost => ({
    system,
    subscriptionCents,
    bookingFeeCents,
    processingCents,
    totalCents: subscriptionCents + bookingFeeCents + processingCents,
  });
  return [
    row("fareharbor", 0, percentFeeCents(received, FEE_ASSUMPTIONS.fareHarborBasisPoints)),
    row("diveday", diveDay.monthlyCents, percentFeeCents(received, diveDay.basisPoints)),
  ];
}
