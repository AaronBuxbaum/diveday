import { and, count, eq, isNotNull, sql } from "drizzle-orm";
import type { DbExecutor } from "@/db/client";
import { pricingVolumeStatements, setupRequests, shopSubscriptions, shops } from "@/db/schema";
import { realShop } from "@/features/founder-metrics";
import { PRICING_PLANS, type PricingPlan } from "@/lib/billing/pricing-plans";

/** Billing performance by the plan each shop currently holds; real shops only. */
export type PricingPlanRow = {
  plan: PricingPlan;
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

export async function pricingByPlan(db: DbExecutor): Promise<PricingPlanRow[]> {
  const plan = sql<PricingPlan>`${shopSubscriptions.pricingPlan}`;
  const requests = await db
    .select({ plan: setupRequests.pricingPlan, count: count() })
    .from(setupRequests)
    .where(isNotNull(setupRequests.pricingPlan))
    .groupBy(setupRequests.pricingPlan);
  const shopRows = await db
    .select({
      plan,
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
    .where(and(realShop(), sql`${plan} is not null`))
    .groupBy(plan);
  const volumeRows = await db
    .select({
      plan,
      volumeCents: sql<string>`coalesce(sum(${pricingVolumeStatements.volumeCents}), 0)`,
    })
    .from(pricingVolumeStatements)
    .innerJoin(shopSubscriptions, eq(shopSubscriptions.shopId, pricingVolumeStatements.shopId))
    .innerJoin(shops, eq(shops.id, pricingVolumeStatements.shopId))
    .where(realShop())
    .groupBy(plan);

  return PRICING_PLANS.map((plan) => {
    const shopRow = shopRows.find((row) => row.plan === plan);
    return {
      plan: plan,
      setupRequests: Number(requests.find((row) => row.plan === plan)?.count ?? 0),
      shops: Number(shopRow?.shops ?? 0),
      cardsAdded: Number(shopRow?.cardsAdded ?? 0),
      firstPaid: Number(shopRow?.firstPaid ?? 0),
      activeNow: Number(shopRow?.activeNow ?? 0),
      canceled: Number(shopRow?.canceled ?? 0),
      revenueCents: Number(shopRow?.revenueCents ?? 0),
      payingShops: Number(shopRow?.payingShops ?? 0),
      volumeCents: Number(volumeRows.find((row) => row.plan === plan)?.volumeCents ?? 0),
    };
  });
}
