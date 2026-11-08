import { lastMinuteDealOutcomes, listOutstandingLastMinutePromos } from "@/features/trip-promos";
import type { AppDb } from "../../db/client";
import { listShopPromoCodes, shopPromoOutcomes } from "../../db/shop-promos";
import { getShopStripeAccount } from "../../db/stripe-accounts";

export { canPersonManagePaymentSettings } from "../../db/authz";
export { canAcceptPayments } from "../../db/stripe-accounts";

/**
 * The promos page's question in one call: one page of codes, one page of
 * outstanding last-minute deals (each list paged on its own), the shop's
 * Stripe account, and **what each deal and code sold** (fifth loop, item 28),
 * read for the page's own rows only, one query per list.
 */
export async function getPromosPage(
  db: AppDb,
  shopId: string,
  options: { now: Date; page: number; dealsPage: number },
) {
  const { now } = options;
  const [promoPage, stripeAccount, dealPage] = await Promise.all([
    listShopPromoCodes(db, shopId, { page: options.page, now }),
    getShopStripeAccount(db, shopId),
    listOutstandingLastMinutePromos(db, shopId, now, { page: options.dealsPage }),
  ]);
  const [codes, deals] = await Promise.all([
    shopPromoOutcomes(
      db,
      shopId,
      promoPage.promos.map((code) => code.id),
    ),
    lastMinuteDealOutcomes(
      db,
      shopId,
      dealPage.deals.map((deal) => deal.id),
    ),
  ]);
  return { promoPage, stripeAccount, dealPage, outcomes: { codes, deals } };
}
