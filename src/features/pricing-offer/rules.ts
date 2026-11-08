import { pricingConfig } from "@/features/pricing-flags";
import { configuredPricing, type PlanTerms } from "@/lib/billing/pricing-plans";

/** The configured offer, shared by every visitor without reading request state. */
export async function requestPricingOffer(): Promise<PlanTerms> {
  return configuredPricing(pricingConfig());
}
