import { percentFeeCents } from "../../lib/billing/pricing-plans";

/**
 * **What a shop would pay each month on FareHarbor and on DiveDay, counted the same way**
 * (Aaron, 2026-11-18). The `/pricing` comparison slider. Every figure is an
 * estimate for a reader to move, never a quote: the assumptions below are named
 * on the page beside the sources and the date each was checked.
 *
 * Software fee and card processing are counted together, because FareHarbor's
 * reported ~6% already includes processing while DiveDay's percent does
 * not; comparing the percents alone would flatter DiveDay by about three
 * points. Amounts are USD cents.
 */
export const FEE_ASSUMPTIONS = {
  /** An average sale, which only the card processor's fixed part depends on. */
  averageSaleCents: 15_000,
  /** Stripe's published US rate for a domestic card: 2.9% + 30¢ (stripe.com/pricing, 2026-11-18). */
  cardBasisPoints: 290,
  cardFixedCents: 30,
  /** FareHarbor: no published schedule; a third-party report of ~6% including processing (2026-04-29). */
  fareHarborBasisPoints: 600,
  /** Booking.com publishes no rate we could confirm for dive activities; hotels pay 10 to 25%. */
  bookingComBasisPoints: 1_500,
} as const;

export const COMPARED_SYSTEMS = ["fareharbor", "diveday"] as const;
export type ComparedSystem = (typeof COMPARED_SYSTEMS)[number];

export type SystemCost = {
  system: ComparedSystem;
  /** The system's own fee, which for FareHarbor includes card processing. */
  softwareCents: number;
  /** Card processing paid on top of the software fee; 0 where the software fee already includes it. */
  processingCents: number;
  /** Booking.com's commission on the share of money that comes through it; the same in every column. */
  bookingComCents: number;
  totalCents: number;
};

export type DiveDayTerms = { monthlyCents: number; basisPoints: number };

/**
 * `bookingComShare` is the fraction (0 to 1) of the month's money that comes
 * through Booking.com, or 0 with the toggle off. Money through Booking.com
 * pays no card processing to the shop, and is charged the percent by FareHarbor
 * (its reported 6% is on every channel) and by DiveDay (which counts money
 * recorded as received): the choice that leans toward the competitor.
 */
export function compareMonth(
  receivedCents: number,
  bookingComShare: number,
  diveDay: DiveDayTerms,
): readonly SystemCost[] {
  const received = Math.max(0, Math.round(receivedCents));
  const share = Math.min(1, Math.max(0, bookingComShare));
  const viaBookingCom = Math.round(received * share);
  const direct = received - viaBookingCom;
  const sales = Math.ceil(direct / FEE_ASSUMPTIONS.averageSaleCents);
  const processing =
    percentFeeCents(direct, FEE_ASSUMPTIONS.cardBasisPoints) +
    sales * FEE_ASSUMPTIONS.cardFixedCents;
  const bookingCom = percentFeeCents(viaBookingCom, FEE_ASSUMPTIONS.bookingComBasisPoints);
  const row = (
    system: ComparedSystem,
    softwareCents: number,
    processingCents: number,
  ): SystemCost => ({
    system,
    softwareCents,
    processingCents,
    bookingComCents: bookingCom,
    totalCents: softwareCents + processingCents + bookingCom,
  });
  return [
    row("fareharbor", percentFeeCents(received, FEE_ASSUMPTIONS.fareHarborBasisPoints), 0),
    row(
      "diveday",
      diveDay.monthlyCents + percentFeeCents(received, diveDay.basisPoints),
      processing,
    ),
  ];
}

/**
 * What one sale moved from Booking.com to the shop's own booking page saves,
 * as a share of the sale: Booking.com's rate less DiveDay's all-in rate on a
 * card sale of the average size. Zero when moving would cost more.
 */
export function directSavingBasisPoints(diveDay: DiveDayTerms): number {
  const sale = FEE_ASSUMPTIONS.averageSaleCents;
  const own =
    percentFeeCents(sale, diveDay.basisPoints) +
    percentFeeCents(sale, FEE_ASSUMPTIONS.cardBasisPoints) +
    FEE_ASSUMPTIONS.cardFixedCents;
  const theirs = percentFeeCents(sale, FEE_ASSUMPTIONS.bookingComBasisPoints);
  return Math.max(0, Math.round(((theirs - own) / sale) * 10_000));
}
