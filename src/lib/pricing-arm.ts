import {
  isPricingPlan,
  type PricingConfig,
  type PricingPlan,
  randomPricingPlan,
} from "@/lib/billing/pricing-plans";

/**
 * **Which pricing arm a visitor sees** (ADR 20261022-pricing-ab-test). While
 * the test is on, `src/proxy.ts` gives each visitor to a marketing page a
 * random arm at the configured split and keeps it in a first-party cookie, so
 * the price a reader saw on `/` is the one `/pricing` repeats and the one the
 * set-up request they send records. While the test is off, no cookie is
 * written and nothing here reads the request: every page says what it says
 * today.
 *
 * The proxy hands the arm on as a request header it always overwrites, so the
 * first visit (whose cookie is only being set on the response) renders the
 * arm it was just given, and a header a client sends never survives.
 *
 * The arm is not a secret and not a capability. A visitor who edits the cookie
 * sees the other arm's copy and, at most, has their set-up request recorded on
 * it; the shop's plan is still stored and charged by DiveDay.
 */

export const PRICING_ARM_COOKIE = "dd_pricing";
/** Ninety days: long enough to cover a shop's decision, short of a season's memory. */
export const PRICING_ARM_COOKIE_MAX_AGE = 90 * 24 * 60 * 60;
export const PRICING_ARM_HEADER = "x-diveday-pricing-arm";

/** The pages that state a price, and the set-up form that records which one was seen. */
const PRICING_MARKETING_PATHS = new Set(["/", "/pricing", "/get-set-up"]);

export function isPricingMarketingPath(pathname: string): boolean {
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return PRICING_MARKETING_PATHS.has(trimmed);
}

/**
 * The proxy's decision for one request: the arm to pass on (or none), and
 * whether to write the cookie. Pure, so the whole matrix is tested without a
 * request.
 */
export function visitorPricingArm(input: {
  pathname: string;
  cookie: string | undefined;
  config: PricingConfig;
  random?: () => number;
}): { arm: PricingPlan | null; setCookie: boolean } {
  if (!input.config.test || !isPricingMarketingPath(input.pathname)) {
    return { arm: null, setCookie: false };
  }
  if (isPricingPlan(input.cookie)) return { arm: input.cookie, setCookie: false };
  return { arm: randomPricingPlan(input.config.split, input.random), setCookie: true };
}
