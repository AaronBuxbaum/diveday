import type { Metadata } from "next";
import { requestPricingOffer } from "@/features/pricing-offer";
import { sharedLinkCard } from "@/lib/marketing";

/** /pricing's metadata, for the configured offer; kept beside the page so the route file stays under its baseline. */
const flatMetadata: Metadata = {
  title: "Pricing — one flat price per shop | DiveDay",
  description:
    "One flat price per shop location, line by line: no setup fee, no per-seat charge, no feature tiers and no cut of your bookings. A three-week trial with no card.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    ...sharedLinkCard,
    title: "DiveDay pricing — one flat price per shop",
    description:
      "One plan, line by line. No setup fee, no per-seat charge and no cut of your bookings.",
    url: "/pricing",
  },
  // `summary_large_image`: the shared link card (`sharedLinkCard`, served from
  // `/link-card`) gives the large card an image to fill it — docs/product/marketing.md,
  // Twitter-card policy. The
  // price figure deliberately stays out of the card: it lives in exactly one
  // place (`earlyAccessPrice`), and a card is a copy that goes stale silently.
  twitter: {
    card: "summary_large_image",
    title: "DiveDay pricing — one flat price per shop",
    description:
      "One plan, line by line. No setup fee, no per-seat charge and no cut of your bookings.",
  },
};

/**
 * The percentage offer’s metadata (ADR 20261022-pricing-ab-test): the monthly-only offer’s
 * "one flat price" and "no cut of your bookings" are not true of it, so it
 * says what both arms share and names no figure, like the monthly-only offer’s.
 */
const percentMetadata: Metadata = {
  title: "Pricing — one plan per shop, line by line | DiveDay",
  description:
    "One plan per shop location, line by line: no setup fee, no per-seat charge and no feature tiers. A three-week trial with no card.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    ...sharedLinkCard,
    title: "DiveDay pricing — one plan per shop",
    description: "One plan, line by line. No setup fee, no per-seat charge and no feature tiers.",
    url: "/pricing",
  },
  twitter: {
    card: "summary_large_image",
    title: "DiveDay pricing — one plan per shop",
    description: "One plan, line by line. No setup fee, no per-seat charge and no feature tiers.",
  },
};

/** Metadata follows the configured offer without reading visitor state. */
export async function generateMetadata(): Promise<Metadata> {
  return (await requestPricingOffer()).basisPoints > 0 ? percentMetadata : flatMetadata;
}
