import { percentFeeCents } from "../../lib/billing/pricing-plans";

/**
 * **What a shop would pay each month on FareHarbor and on DiveDay, counted the same way**
 * (Aaron, 2026-11-18; one revenue base, Aaron, 2026-11-20). The `/pricing` comparison slider
 * is the money a shop takes for trips and courses in a month. Every figure is an
 * estimate for a reader to move, never a quote: the assumptions below are named
 * on the page beside the sources and the date each was checked.
 *
 * Both columns are a subscription, a percent of **all** of that money, and the same
 * card processing on top. FareHarbor adds a 2% OTA booking fee on top of the booking price
 * for the share of bookings that come through online travel agencies (37%, Arival, linked beside
 * the figures); DiveDay adds nothing there. Three of four write-ups say FareHarbor's percent is charged
 * with card processing on top (CaptainBook 2026-04-09, TrekkSoft 2026-06-30, Levy 2026),
 * and Aaron agrees. Amounts are USD cents.
 */
export const FEE_ASSUMPTIONS = {
  /** An average sale, which only the card processor's fixed part depends on. */
  averageSaleCents: 15_000,
  /** The published US rate for a domestic card, Stripe's 2.9% + 30¢ (stripe.com/pricing, 2026-11-18), for both columns. */
  cardBasisPoints: 290,
  cardFixedCents: 30,
  /** FareHarbor: no published schedule; third-party reports of ~6% of a booking, no monthly fee (2026). */
  fareHarborBasisPoints: 600,
  /** FareHarbor's OTA booking fee, on top of the booking price, on a marketplace sale (Aaron, 2026-11-18). */
  fareHarborOtaBasisPoints: 200,
  /** The share of bookings that come through online travel agencies, in basis points (Arival, `otaSourceUrl`; Aaron, 2026-11-18). */
  otaShareBasisPoints: 3_700,
  /** The report that figure comes from, linked from the page. */
  otaSourceUrl: "https://arival.travel/article/direct-bookings-dive-otas-rise/",
} as const;

export const COMPARED_SYSTEMS = ["fareharbor", "diveday"] as const;
export type ComparedSystem = (typeof COMPARED_SYSTEMS)[number];

export type SystemCost = {
  system: ComparedSystem;
  /** The monthly subscription: nothing for FareHarbor, the offer's monthly fee for DiveDay. */
  subscriptionCents: number;
  /** The system's percent of the month's money. */
  bookingFeeCents: number;
  /** FareHarbor's OTA booking fee on the marketplace share of the month; 0 for DiveDay. */
  otaFeeCents: number;
  /** Card processing on the month's money. */
  processingCents: number;
  /** Everything above, for the month. */
  totalCents: number;
};

export type DiveDayTerms = { monthlyCents: number; basisPoints: number };

/** The month's money: every percent off the whole amount, FareHarbor's OTA fee off the 37% that comes through agencies. */
export function compareMonth(receivedCents: number, diveDay: DiveDayTerms): readonly SystemCost[] {
  const received = Math.max(0, Math.round(receivedCents));
  const viaOta = percentFeeCents(received, FEE_ASSUMPTIONS.otaShareBasisPoints);
  const sales = Math.ceil(received / FEE_ASSUMPTIONS.averageSaleCents);
  const processingCents =
    percentFeeCents(received, FEE_ASSUMPTIONS.cardBasisPoints) +
    sales * FEE_ASSUMPTIONS.cardFixedCents;
  const row = (
    system: ComparedSystem,
    subscriptionCents: number,
    bookingFeeCents: number,
    otaFeeCents: number,
  ): SystemCost => ({
    system,
    subscriptionCents,
    bookingFeeCents,
    otaFeeCents,
    processingCents,
    totalCents: subscriptionCents + bookingFeeCents + otaFeeCents + processingCents,
  });
  return [
    row(
      "fareharbor",
      0,
      percentFeeCents(received, FEE_ASSUMPTIONS.fareHarborBasisPoints),
      percentFeeCents(viaOta, FEE_ASSUMPTIONS.fareHarborOtaBasisPoints),
    ),
    row("diveday", diveDay.monthlyCents, percentFeeCents(received, diveDay.basisPoints), 0),
  ];
}
