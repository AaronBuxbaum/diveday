import { getDb } from "@/db/client";
import { billingProviderFromEnvironment, percentBillingFromEnvironment } from "@/features/billing";
import { cronRoute } from "@/features/cron-route";
import { pricingConfig } from "@/features/pricing-flags";
import { PRICING_CLOSE_CRONTAB } from "@/lib/billing/pricing-plans";
import { nowDate } from "@/lib/clock";
import { closePercentMonths } from "./close-pass";

/** One statement and at most one Stripe call per percent-plan shop. */
export const maxDuration = 300;

/**
 * **The percent plan's monthly close** (ADR 20261022-pricing-ab-test): last
 * month's statement for each percent-plan shop, and its fee reported to
 * Stripe's meter (`closePercentMonths`). Idempotent, so the 3rd's run retries
 * what the 2nd could not report and changes nothing else.
 */
export const GET = cronRoute({
  id: "pricing-volume",
  crontab: PRICING_CLOSE_CRONTAB,
  run: async () =>
    closePercentMonths(await getDb(), {
      now: nowDate(),
      config: pricingConfig(),
      provider: billingProviderFromEnvironment(),
      percent: percentBillingFromEnvironment(),
    }),
});
