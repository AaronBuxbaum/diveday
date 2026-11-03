import type { MonthRef } from "@/lib/calendar";
import type { AppDb } from "./client";
import { latestPricingStatement, processedVolumeCents } from "./pricing-volume";
import { getShopSubscription } from "./shop-subscriptions";

export { canPersonManageBilling } from "./authz";
export { holdsLiveSubscription, shopPricing, subscriptionSnapshot } from "./shop-subscriptions";

/** The billing page's question: the shop's subscription row, if it has one. */
export async function getBillingPage(db: AppDb, shopId: string) {
  return { subscription: await getShopSubscription(db, shopId) };
}

/**
 * The percent plan's running month, read once the page knows the shop is on
 * it: the month's processed volume after the free time, and the last closed
 * statement.
 */
export async function getBillingPercentMonth(
  db: AppDb,
  shopId: string,
  month: MonthRef,
  timeZone: string,
  freeUntil: Date | null,
) {
  const [volumeCents, statement] = await Promise.all([
    processedVolumeCents(db, shopId, month, timeZone, freeUntil),
    latestPricingStatement(db, shopId),
  ]);
  return { volumeCents, statement };
}
