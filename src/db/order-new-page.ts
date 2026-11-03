import type { AppDb } from "./client";
import { getBookingContext, listOrderableCustomers } from "./orders";
import { canAcceptPayments, getShopStripeAccount } from "./stripe-accounts";

/**
 * The new order panel's question in one call. A shop that cannot accept
 * payments reads nothing more (the index refuses it); otherwise the customers
 * it may bill and the booking it was opened from, if any.
 */
export async function getOrderNewPage(db: AppDb, shopId: string, bookingId?: string | null) {
  const account = await getShopStripeAccount(db, shopId);
  if (!canAcceptPayments(account)) return { acceptsPayments: false as const };
  const [customers, bookingContext] = await Promise.all([
    listOrderableCustomers(db, shopId),
    bookingId ? getBookingContext(db, shopId, bookingId) : null,
  ]);
  return { acceptsPayments: true as const, customers, bookingContext };
}
