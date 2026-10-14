import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { boundLockWaits } from "./lock-bounds";
import { bookings, trips } from "./schema";

/**
 * **Lock a seat's departure before the seat** — the one order every seat
 * writer takes, written down beside `createBookingRecord` (`./bookings.ts`).
 *
 * For a path that starts from a booking id: reads which departure the seat is
 * on (a booking never changes departure, so the unlocked read is stable),
 * takes that trip row `for no key update`, and returns its id for the caller
 * to lock the booking under. Null when this shop has no such booking.
 *
 * `for no key update` rather than `for update`: it still serializes against
 * every other seat writer and every trip edit, but not against a `KEY SHARE`,
 * which is what the crew's roll-call insert takes on the trip for its foreign
 * key while it already holds the booking. With `for update` here the two
 * would deadlock (`seat-lock-order.postgres.test.ts`).
 */
export async function lockSeatDeparture(
  tx: DbExecutor,
  shopId: string,
  bookingId: string,
): Promise<string | null> {
  await boundLockWaits(tx);
  const [seat] = await tx
    .select({ tripId: bookings.tripId })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
    .limit(1);
  if (!seat) return null;
  const [trip] = await tx
    .select({ id: trips.id })
    .from(trips)
    // diveday:allow-deleted-trips: a lock, not a read — each caller's own
    // query decides whether a deleted departure is found.
    .where(and(eq(trips.id, seat.tripId), eq(trips.shopId, shopId)))
    .limit(1)
    .for("no key update");
  return trip?.id ?? null;
}
