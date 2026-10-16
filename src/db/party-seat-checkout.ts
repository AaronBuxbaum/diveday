import { and, eq, isNull, ne } from "drizzle-orm";
import { type StartCheckoutOutcome, startBookingCheckout } from "./checkouts";
import type { AppDb } from "./client";
import { bookings } from "./schema";

type StartCheckoutInput = Parameters<typeof startBookingCheckout>[1];
type StartCheckoutProvider = Parameters<typeof startBookingCheckout>[2];

/**
 * **A party lead pays for one seat they added** (issue #2474): a hosted
 * checkout for that seat only, started from the lead's bearer-token `/ready`
 * page. That page is shared by design, so this is the boundary that decides
 * whose seat may be charged, not the button.
 *
 * The seat must be a booked seat the lead's own party holds in this shop, on
 * the lead's departure, that nobody has claimed (a claimed seat has an owner
 * who pays with their own link), and the lead must be a lead, not itself a
 * member. Anything else is `invalid`, with no word on which part failed.
 * Whether the seat is already paid, priced, or the shop connected is
 * `startBookingCheckout`'s to refuse, as it is for every other charge.
 */
export async function startPartySeatCheckout(
  db: AppDb,
  input: Omit<StartCheckoutInput, "bookingIds"> & { leadBookingId: string; seatBookingId: string },
  checkout?: StartCheckoutProvider,
): Promise<StartCheckoutOutcome> {
  const { leadBookingId, seatBookingId, ...checkoutInput } = input;
  const [lead] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.id, leadBookingId),
        eq(bookings.shopId, input.shopId),
        eq(bookings.tripId, input.tripId),
        ne(bookings.status, "cancelled"),
        isNull(bookings.partyLeadBookingId),
      ),
    )
    .limit(1);
  if (!lead) return { ok: false, reason: "invalid" };
  const [seat] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.id, seatBookingId),
        eq(bookings.shopId, input.shopId),
        eq(bookings.tripId, input.tripId),
        eq(bookings.partyLeadBookingId, leadBookingId),
        ne(bookings.status, "cancelled"),
        isNull(bookings.claimedAt),
      ),
    )
    .limit(1);
  if (!seat) return { ok: false, reason: "invalid" };
  return startBookingCheckout(db, { ...checkoutInput, bookingIds: [seat.id] }, checkout);
}
