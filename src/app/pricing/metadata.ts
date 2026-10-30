import type { Metadata } from "next";
import { sharedLinkCard } from "@/lib/marketing";
import { requestPricingArm } from "@/lib/pricing-arm-request";
import { pricingConfig } from "@/lib/pricing-flags";

/** /pricing's metadata, per pricing arm; kept beside the page so the route file stays under its baseline. */
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
  // `summary_large_image`: the OG block above names the shared card via
  // `sharedLinkCard`; its image is served at `src/app/link-card/route.tsx` —
  // docs/product/marketing.md, Twitter-card policy. The
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
 * The percent arm's metadata (ADR 20261022-pricing-ab-test): the flat arm's
 * "one flat price" and "no cut of your bookings" are not true of it, so it
 * says what both arms share and names no figure, like the flat arm's.
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

/**
 * Per arm. While the pricing test is off this reads nothing from the request
 * and is the flat arm's metadata, exactly as the static export was.
 */
export async function generateMetadata(): Promise<Metadata> {
  const config = pricingConfig();
  if (!config.test) return flatMetadata;
  return (await requestPricingArm(config)) === "percent_of_volume" ? percentMetadata : flatMetadata;
}
