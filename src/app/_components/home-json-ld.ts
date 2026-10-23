import type { PlanTerms } from "@/lib/billing/pricing-plans";
import type { JsonLdObject } from "@/lib/structured-data";

/**
 * The home page's `SoftwareApplication` graph, per pricing arm (ADR
 * 20261022-pricing-ab-test). The flat arm's `Offer` carries its monthly fee as
 * a bare amount, "99" at today's price. The percent arm's fee is a share of
 * card money, which an `Offer` price cannot state without reading as the whole
 * price or as free, so its graph carries no `Offer` at all.
 */
export function homeSoftwareJsonLd(offer: PlanTerms): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "DiveDay",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description:
      "Dive shop software for bookings, waivers, cert checks, trip prep, and boat manifests.",
    offers:
      offer.plan === "flat_monthly"
        ? { "@type": "Offer", price: String(offer.monthlyCents / 100), priceCurrency: "USD" }
        : undefined,
  };
}
