import type { AppDb } from "./client";
import { counterRentalWaiverStandings, getCounterRentalTicket } from "./gear-counter-rentals";
import { getOrder } from "./orders";

/**
 * The counter rental ticket page's question in one call: the ticket, the order
 * that bills it, and the renter's waiver standing. Null when the ticket is not
 * this shop's.
 */
export async function getCounterRentalTicketPage(
  db: AppDb,
  shop: { id: string; timezone: string },
  ticketId: string,
) {
  const ticket = await getCounterRentalTicket(db, shop.id, ticketId);
  if (!ticket) return null;
  const [billing, waivers] = await Promise.all([
    ticket.orderId ? getOrder(db, shop.id, ticket.orderId) : null,
    counterRentalWaiverStandings(db, {
      shopId: shop.id,
      timezone: shop.timezone,
      personIds: [ticket.personId],
    }),
  ]);
  return { ticket, billing, waivers };
}
