import { eq } from "drizzle-orm";
import type { DbExecutor } from "@/db/client";
import { bookingArrivalEvents, bookings } from "@/db/schema";
import { nowDate } from "@/lib/clock";

/**
 * **Check a seat in, for a test that needs one standing**, by appending the
 * `arrived` row every reader reads (issue #2702: arrival is a trail, never a
 * seat status). A direct insert, not `checkInBooking`: that writer re-reads
 * readiness and refuses a sailed boat, which is right for a desk and in the
 * way of a fixture. A test about the check-in itself calls the writer.
 *
 * `recordedByPersonId` defaults to the seat's own person; pass a staffer when
 * the test reads who said so.
 */
export async function markArrived(
  db: DbExecutor,
  bookingId: string,
  options: { recordedByPersonId?: string; occurredAt?: Date; status?: "arrived" | "cleared" } = {},
): Promise<void> {
  const [seat] = await db
    .select({ shopId: bookings.shopId, tripId: bookings.tripId, personId: bookings.personId })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!seat) throw new Error(`markArrived: no booking ${bookingId}`);
  await db.insert(bookingArrivalEvents).values({
    shopId: seat.shopId,
    tripId: seat.tripId,
    bookingId,
    recordedByPersonId: options.recordedByPersonId ?? seat.personId,
    status: options.status ?? "arrived",
    source: "live",
    occurredAt: options.occurredAt ?? nowDate(),
  });
}
