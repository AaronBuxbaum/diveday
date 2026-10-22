import { and, count, eq, isNotNull, sql } from "drizzle-orm";
import { PRICING_PLANS, type PricingPlan } from "@/lib/billing/pricing-plans";
import type { DbExecutor } from "./client";
import { realShop } from "./founder-metrics";
import { pricingVolumeStatements, setupRequests, shopSubscriptions, shops } from "./schema";

/**
 * **The pricing test, per arm** (ADR 20261022-pricing-ab-test), for
 * `pnpm billing:pricing-test`. Real shops only, on founder metrics' own test
 * (`realShop`): a demo or a seeded row nobody can sign into is never counted.
 *
 * A shop counts in the arm it was **assigned** (the set-up request's, or its
 * bucket), not the plan an override moved it to, so a hand-made deal does not
 * move a shop between arms after the fact; a shop with no assigned arm counts
 * in the plan it holds.
 */
export type PricingArmRow = {
  arm: PricingPlan;
  setupRequests: number;
  shops: number;
  cardsAdded: number;
  firstPaid: number;
  activeNow: number;
  canceled: number;
  revenueCents: number;
  payingShops: number;
  volumeCents: number;
};

export async function pricingTestByArm(db: DbExecutor): Promise<PricingArmRow[]> {
  const arm = sql<PricingPlan>`coalesce(${shopSubscriptions.assignedPricingPlan}, ${shopSubscriptions.pricingPlan})`;
  const requests = await db
    .select({ arm: setupRequests.pricingPlan, count: count() })
    .from(setupRequests)
    .where(isNotNull(setupRequests.pricingPlan))
    .groupBy(setupRequests.pricingPlan);
  const shopRows = await db
    .select({
      arm,
      shops: count(),
      cardsAdded: sql<number>`count(*) filter (where ${shopSubscriptions.stripeSubscriptionId} is not null)`,
      firstPaid: sql<number>`count(*) filter (where ${shopSubscriptions.firstPaidAt} is not null)`,
      activeNow: sql<number>`count(*) filter (where ${shopSubscriptions.stripeStatus} in ('active', 'trialing', 'past_due'))`,
      canceled: sql<number>`count(*) filter (where ${shopSubscriptions.stripeStatus} = 'canceled')`,
      revenueCents: sql<string>`coalesce(sum(${shopSubscriptions.paidTotalCents}), 0)`,
      payingShops: sql<number>`count(*) filter (where ${shopSubscriptions.paidTotalCents} > 0)`,
    })
    .from(shopSubscriptions)
    .innerJoin(shops, eq(shops.id, shopSubscriptions.shopId))
    .where(and(realShop(), sql`${arm} is not null`))
    .groupBy(arm);
  const volumeRows = await db
    .select({
      arm,
      volumeCents: sql<string>`coalesce(sum(${pricingVolumeStatements.volumeCents}), 0)`,
    })
    .from(pricingVolumeStatements)
    .innerJoin(shopSubscriptions, eq(shopSubscriptions.shopId, pricingVolumeStatements.shopId))
    .innerJoin(shops, eq(shops.id, pricingVolumeStatements.shopId))
    .where(realShop())
    .groupBy(arm);

  return PRICING_PLANS.map((plan) => {
    const shopRow = shopRows.find((row) => row.arm === plan);
    return {
      arm: plan,
      setupRequests: Number(requests.find((row) => row.arm === plan)?.count ?? 0),
      shops: Number(shopRow?.shops ?? 0),
      cardsAdded: Number(shopRow?.cardsAdded ?? 0),
      firstPaid: Number(shopRow?.firstPaid ?? 0),
      activeNow: Number(shopRow?.activeNow ?? 0),
      canceled: Number(shopRow?.canceled ?? 0),
      revenueCents: Number(shopRow?.revenueCents ?? 0),
      payingShops: Number(shopRow?.payingShops ?? 0),
      volumeCents: Number(volumeRows.find((row) => row.arm === plan)?.volumeCents ?? 0),
    };
  });
}
