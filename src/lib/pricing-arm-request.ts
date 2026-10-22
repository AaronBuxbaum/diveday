import { headers } from "next/headers";
import {
  isPricingPlan,
  type PlanTerms,
  type PricingConfig,
  type PricingPlan,
  termsFor,
} from "@/lib/billing/pricing-plans";
import { PRICING_ARM_HEADER } from "@/lib/pricing-arm";
import { pricingConfig } from "@/lib/pricing-flags";

/**
 * The request half of `src/lib/pricing-arm.ts`: what a page and the set-up
 * action read. Kept out of that module so the proxy, which imports it, never
 * pulls in `next/headers`.
 */

/**
 * The arm this request's reader sees, or the flat plan. Reads nothing from the
 * request while the test is off, so a page that was static stays static.
 */
export async function requestPricingArm(
  config: PricingConfig = pricingConfig(),
): Promise<PricingPlan> {
  return (await requestVisitorArm(config)) ?? "flat_monthly";
}

/**
 * The arm the proxy gave this request, or null: the test is off, or the
 * request came by a path the proxy assigns no arm on. What a set-up request
 * records, so "saw no arm" is never stored as "saw the flat one".
 */
export async function requestVisitorArm(
  config: PricingConfig = pricingConfig(),
): Promise<PricingPlan | null> {
  if (!config.test) return null;
  const value = (await headers()).get(PRICING_ARM_HEADER);
  return isPricingPlan(value) ? value : null;
}

/** The plan and numbers this request's reader is shown. */
export async function requestPricingOffer(): Promise<PlanTerms> {
  const config = pricingConfig();
  return termsFor(await requestPricingArm(config), config);
}
