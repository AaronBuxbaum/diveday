import type { AppDb } from "../../db/client";
import { getBookingContext, getOrderableCustomer } from "../../db/orders";
import { canAcceptPayments, getShopStripeAccount } from "../../db/stripe-accounts";

/**
 * The new order panel's question in one call. A shop that cannot accept
 * payments reads nothing more (the index refuses it); otherwise the customer a
 * link named and the booking it was opened from, if any. Anyone else is found
 * by the picker's search (issue #4601).
 */
export async function getOrderNewPage(
  db: AppDb,
  shopId: string,
  { bookingId, personId }: { bookingId?: string | null; personId?: string | null } = {},
) {
  const account = await getShopStripeAccount(db, shopId);
  if (!canAcceptPayments(account)) return { acceptsPayments: false as const };
  const [customer, bookingContext] = await Promise.all([
    personId ? getOrderableCustomer(db, shopId, personId) : null,
    bookingId ? getBookingContext(db, shopId, bookingId) : null,
  ]);
  return { acceptsPayments: true as const, customer, bookingContext };
}
