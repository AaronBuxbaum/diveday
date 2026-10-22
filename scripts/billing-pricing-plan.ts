/**
 * `pnpm billing:pricing-plan <shop-slug> <flat|percent|auto> [--monthly-cents N] [--basis-points N]`
 * — put one shop on a pricing plan by hand, optionally on its own numbers, or
 * (`auto`) back on the arm it was assigned (ADR 20261022-pricing-ab-test).
 *
 * The pattern of `pnpm billing:free-term`: it runs against whatever database
 * `getDb()` resolves (`DATABASE_URL` through `dotenv -c`, else the dev PGlite
 * directory, so stop `pnpm dev` first). The numbers are held to the same
 * bounds as the `PRICING_*` environment; a number left out takes the
 * environment's value for that plan. A shop holding a live subscription cannot
 * move to another plan or monthly fee: cancel it first.
 */
import { getDb } from "@/db/client";
import { setShopPricingPlan } from "@/db/shop-subscriptions";
import { parsePricingPlanArgs, type PlanTerms } from "@/lib/billing/pricing-plans";
import { pricingConfig } from "@/lib/pricing-flags";

const USAGE =
  "Usage: pnpm billing:pricing-plan <shop-slug> <flat|percent|auto> [--monthly-cents 0-100000] [--basis-points 0-1000]";

const ARG_ERRORS: Record<string, string> = {
  usage: USAGE,
  monthly_cents: `--monthly-cents takes a whole number from 0 to 100000. ${USAGE}`,
  basis_points: `--basis-points takes a whole number from 0 to 1000 (300 is 3%). ${USAGE}`,
  auto_takes_no_numbers: `auto puts the shop back on its assigned arm and takes no numbers. ${USAGE}`,
  flat_takes_no_basis_points: `The flat plan has no percentage. ${USAGE}`,
};

function describe(terms: PlanTerms): string {
  const monthly = `${terms.monthlyCents} cents a month`;
  return terms.plan === "flat_monthly"
    ? `flat, ${monthly}`
    : `percent, ${terms.basisPoints} basis points plus ${monthly}`;
}

async function main(argv: readonly string[]): Promise<number> {
  const parsed = parsePricingPlanArgs(argv);
  if (!parsed.ok) {
    console.error(ARG_ERRORS[parsed.error] ?? USAGE);
    return 2;
  }
  const { args } = parsed;
  const db = await getDb();
  const outcome = await setShopPricingPlan(db, args, pricingConfig());
  switch (outcome.status) {
    case "no_such_shop":
      console.error(`No shop has the slug "${args.shopSlug}".`);
      return 1;
    case "demo_shop":
      console.error(`"${args.shopSlug}" is a demo shop, and a demo shop is never billed.`);
      return 1;
    case "live_subscription":
      console.error(
        `${args.shopSlug} holds a live subscription on ${describe(outcome.current)}. Cancel it first (Settings > Billing > Cancel plan, or the Stripe dashboard), then run this again.`,
      );
      return 1;
    case "set":
      console.log(
        args.plan === null
          ? `${args.shopSlug} is back on its assigned arm: ${describe(outcome.terms)}.`
          : `${args.shopSlug} is on ${describe(outcome.terms)}, set by hand.`,
      );
      return 0;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
