import { and, desc, eq } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { bookingArrivalEvents } from "./schema";

/**
 * **What the trail currently says about one seat**, as the word itself rather
 * than a verdict on it — the question a writer of `bookings.status` asks before
 * it puts that slot back.
 *
 * The only reader of this trail that answers a writer rather than a person:
 * `undoBookingNoShow` (`src/db/no-show.ts`) puts a released seat back and needs
 * the state it was released *from*, and guessing that is how the slot and the
 * trail drift apart.
 *
 * **The trail is a record of who was seen, never of who dived** — and no
 * reader here may spend it as the latter. Until a `dive-domain-expert` review
 * on 2026-09-11 a third export let a standing `arrived` row outrank
 * `bookings.status = 'no_show'` in the two dive-day readers, against a
 * close-of-day sweep that does not exist. The only writer of that status is
 * one staffer's deliberate tap, always later than the check-in it overwrites,
 * so the escape only ever let an earlier human statement beat a later human
 * correction. A diver can be checked in at 06:40 and seasick on the ramp at
 * 06:50; the desk seeing somebody is not the boat carrying them.
 *
 * The same three ordering keys as everything else in this file, and for the
 * same reason: `occurred_at` ties constantly, so the last-appended row has to
 * win or two readers order one pair of taps differently.
 */
export async function standingArrivalStatus(
  tx: DbExecutor,
  shopId: string,
  tripId: string,
  bookingId: string,
): Promise<"arrived" | "cleared" | undefined> {
  const [standing] = await tx
    .select({ status: bookingArrivalEvents.status })
    .from(bookingArrivalEvents)
    .where(
      and(
        eq(bookingArrivalEvents.shopId, shopId),
        eq(bookingArrivalEvents.tripId, tripId),
        eq(bookingArrivalEvents.bookingId, bookingId),
      ),
    )
    .orderBy(
      desc(bookingArrivalEvents.occurredAt),
      desc(bookingArrivalEvents.createdAt),
      desc(bookingArrivalEvents.seq),
    )
    .limit(1);
  return standing?.status;
}
