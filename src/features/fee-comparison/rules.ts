import { percentFeeCents } from "../../lib/billing/pricing-plans";

/**
 * **What a shop would pay each month on FareHarbor and on DiveDay, counted the same way**
 * (Aaron, 2026-11-18). The `/pricing` comparison slider. Every figure is an
 * estimate for a reader to move, never a quote: the assumptions below are named
 * on the page beside the sources and the date each was checked.
 *
 * Both columns are a subscription, a percent of the money the shop takes directly,
 * and the same card processing on top. Three of four write-ups say FareHarbor's
 * percent is charged with card processing on top (CaptainBook 2026-04-09,
 * TrekkSoft 2026-06-30, Levy 2026), and Aaron agrees. Marketplace sales (Booking.com,
 * Viator, GetYourGuide) are shown as a range, because Aaron puts their commission
 * at 15% to 30%; FareHarbor adds a 2% OTA booking fee on them and DiveDay adds
 * nothing. Amounts are USD cents.
 */
export const FEE_ASSUMPTIONS = {
  /** An average sale, which only the card processor's fixed part depends on. */
  averageSaleCents: 15_000,
  /** The published US rate for a domestic card, Stripe's 2.9% + 30¢ (stripe.com/pricing, 2026-11-18), for both columns. */
  cardBasisPoints: 290,
  cardFixedCents: 30,
  /** FareHarbor: no published schedule; third-party reports of ~6% of a direct booking, no monthly fee (2026). */
  fareHarborBasisPoints: 600,
  /** FareHarbor's OTA booking fee on a marketplace sale (Aaron, 2026-11-18). */
  fareHarborOtaBasisPoints: 200,
  /** What Booking.com, Viator and GetYourGuide take from a sale, as a range (Aaron, 2026-11-18). */
  marketplaceLowBasisPoints: 1_500,
  marketplaceHighBasisPoints: 3_000,
} as const;

export const COMPARED_SYSTEMS = ["fareharbor", "diveday"] as const;
export type ComparedSystem = (typeof COMPARED_SYSTEMS)[number];

export type SystemCost = {
  system: ComparedSystem;
  /** The monthly subscription: nothing for FareHarbor, the offer's monthly fee for DiveDay. */
  subscriptionCents: number;
  /** The system's percent of the money taken directly. */
  bookingFeeCents: number;
  /** FareHarbor's OTA booking fee on marketplace sales; 0 for DiveDay. */
  otaFeeCents: number;
  /** Card processing on the money taken directly. */
  processingCents: number;
  /** The marketplaces' own commission on their share of the money; the same in every column. */
  marketplaceLowCents: number;
  marketplaceHighCents: number;
  totalLowCents: number;
  totalHighCents: number;
};

export type DiveDayTerms = { monthlyCents: number; basisPoints: number };

/**
 * `marketplaceShare` is the fraction (0 to 1) of the month's money that comes
 * through the marketplaces, or 0 with the switch off. That money pays no card
 * processing to the shop, no percent to DiveDay, and FareHarbor's OTA fee.
 */
export function compareMonth(
  receivedCents: number,
  marketplaceShare: number,
  diveDay: DiveDayTerms,
): readonly SystemCost[] {
  const received = Math.max(0, Math.round(receivedCents));
  const share = Math.min(1, Math.max(0, marketplaceShare));
  const viaMarketplace = Math.round(received * share);
  const direct = received - viaMarketplace;
  const sales = Math.ceil(direct / FEE_ASSUMPTIONS.averageSaleCents);
  const processingCents =
    percentFeeCents(direct, FEE_ASSUMPTIONS.cardBasisPoints) +
    sales * FEE_ASSUMPTIONS.cardFixedCents;
  const marketplaceLowCents = percentFeeCents(
    viaMarketplace,
    FEE_ASSUMPTIONS.marketplaceLowBasisPoints,
  );
  const marketplaceHighCents = percentFeeCents(
    viaMarketplace,
    FEE_ASSUMPTIONS.marketplaceHighBasisPoints,
  );
  const row = (
    system: ComparedSystem,
    subscriptionCents: number,
    bookingFeeCents: number,
    otaFeeCents: number,
  ): SystemCost => {
    const own = subscriptionCents + bookingFeeCents + otaFeeCents + processingCents;
    return {
      system,
      subscriptionCents,
      bookingFeeCents,
      otaFeeCents,
      processingCents,
      marketplaceLowCents,
      marketplaceHighCents,
      totalLowCents: own + marketplaceLowCents,
      totalHighCents: own + marketplaceHighCents,
    };
  };
  return [
    row(
      "fareharbor",
      0,
      percentFeeCents(direct, FEE_ASSUMPTIONS.fareHarborBasisPoints),
      percentFeeCents(viaMarketplace, FEE_ASSUMPTIONS.fareHarborOtaBasisPoints),
    ),
    row("diveday", diveDay.monthlyCents, percentFeeCents(direct, diveDay.basisPoints), 0),
  ];
}
