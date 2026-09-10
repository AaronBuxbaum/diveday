import { and, eq, isNull, ne } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { boats, bookings, people, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **The seat a paper pass is printed from** (ADR 20260908-one-hand, decision 6,
 * lever X).
 *
 * One booking, read as the pass prints it: who, which departure, which hull,
 * where it leaves from. Its own reader rather than a widening of the counter's
 * queue, because the pass is a document about *one* seat and the queue is a
 * list about a day — and because a document handed to a diver should be
 * obvious about every field it carries.
 *
 * **What it deliberately does not read**: readiness, waivers, medical answers,
 * money. A pass is where to be and when; a diver's state belongs to the
 * counter's screen, and a printed sheet with a medical flag on it is a sheet
 * left on a boat seat.
 *
 * Tenancy is the caller's shop, and the trip must be live: a departure the shop
 * has taken off the board has no pass to print, and `liveTrip` is what stops a
 * deleted one printing (`scripts/check-live-trips.mjs`).
 */
export type PassBooking = {
  bookingId: string;
  diverName: string;
  tripId: string;
  tripTitle: string;
  startsAt: Date;
  boatName: string | null;
  meetingPointLabel: string | null;
  meetingPointAddress: string | null;
};

export async function getPassBooking(
  db: DbExecutor,
  shopId: string,
  bookingId: string,
): Promise<PassBooking | null> {
  const [row] = await db
    .select({
      bookingId: bookings.id,
      diverName: people.fullName,
      tripId: trips.id,
      tripTitle: trips.title,
      startsAt: trips.startsAt,
      boatName: boats.name,
      meetingPointLabel: trips.meetingPointLabel,
      meetingPointAddress: trips.meetingPointAddress,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .leftJoin(boats, eq(boats.id, trips.boatId))
    .where(
      and(
        eq(bookings.id, bookingId),
        eq(bookings.shopId, shopId),
        // A cancelled seat is not a pass. The row survives (every delete is
        // soft), and printing one would hand a diver paper for a boat they are
        // not on.
        ne(bookings.status, "cancelled"),
        isNull(people.deletedAt),
        liveTrip(),
      ),
    );
  return row ?? null;
}
