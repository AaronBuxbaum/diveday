import {
  collectionCurrencies,
  hasIncompleteCollectionEvidence,
  latestPricingStatement,
  processedVolumeCents,
} from "@/features/pricing-volume";
import { getShopSubscription } from "@/features/shop-subscriptions";
import type { AppDb } from "../../db/client";
import type { MonthRef } from "../../lib/calendar";

export {
  holdsLiveSubscription,
  shopPricing,
  subscriptionSnapshot,
} from "@/features/shop-subscriptions";
export { canPersonManageBilling } from "../../db/authz";

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
  const currencies = await collectionCurrencies(db, shopId);
  return Promise.all(
    currencies.map(async (currency) => {
      const [volumeCents, statement, pendingEvidence] = await Promise.all([
        processedVolumeCents(db, shopId, month, timeZone, freeUntil, null, currency),
        latestPricingStatement(db, shopId, currency),
        hasIncompleteCollectionEvidence(db, shopId, currency, freeUntil),
      ]);
      return { currency, volumeCents, statement, pendingEvidence };
    }),
  );
}
