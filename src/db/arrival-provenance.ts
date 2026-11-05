import { and, desc, eq, sql } from "drizzle-orm";
import type { StandingArrival } from "@/lib/presence";
import type { DbExecutor } from "./client";
import { bookingArrivalEvents, bookings } from "./schema";

/**
 * **Where arrival is read from** (issue #2702, ADR 20261104-arrival-is-a-trail).
 *
 * `bookings.status` says what the shop decided about the seat and nothing
 * about the person; the desk's sighting is `booking_arrival_events`, and the
 * newest row per seat is the answer. Every reader of "checked in" asks this
 * file, in one of two shapes: `seatCheckedIn` inside a query over `bookings`,
 * or `standingArrivalStatus` for one seat inside a writer's transaction.
 *
 * **The trail is a record of who was seen, never of who dived** — and no
 * reader here may spend it as the latter. A diver can be checked in at 06:40
 * and seasick on the ramp at 06:50; the desk seeing somebody is not the boat
 * carrying them (ADR 20260907-the-counter-survives-offline, decision 4).
 *
 * The same three ordering keys everywhere, and the same keys `recordRollCall`
 * reads its own trail by: `occurred_at` ties constantly under a frozen clock or
 * a batched offline sync, so the last-appended row has to win or two readers
 * order one pair of taps differently.
 */

/**
 * Only the sightings of the seat's current life. A seat that came back from
 * cancelled, from Remove, or from another departure
 * (`bookings.arrival_trail_after_seq`) is a new seat at the desk: an `arrived`
 * row from before it reopened says nothing about today, and reading it would
 * let the desk's next tap skip readiness as a duplicate. Needs `bookings` in
 * the query.
 */
const sinceSeatReopened = sql<boolean>`(${bookings.arrivalTrailAfterSeq} is null or ${bookingArrivalEvents.seq} > ${bookings.arrivalTrailAfterSeq})`;

/**
 * The value a writer reopening a seat stores in
 * `bookings.arrival_trail_after_seq`: the newest trail row the seat holds
 * now, or 0 when it holds none. Only usable in an update of `bookings`.
 */
export const arrivalTrailHighWater = sql<number>`(
  select coalesce(max(${bookingArrivalEvents.seq}), 0)
  from ${bookingArrivalEvents}
  where ${bookingArrivalEvents.bookingId} = ${bookings.id}
)`;

/**
 * The newest word the desk's trail holds for one seat's current life, or nothing — the raw
 * word, not a verdict. A writer asks it under the seat's lock: the check-in and
 * its undo, to know whether the tap changes anything.
 */
export async function standingArrivalStatus(
  tx: DbExecutor,
  shopId: string,
  tripId: string,
  bookingId: string,
): Promise<StandingArrival | undefined> {
  const [standing] = await tx
    .select({ status: bookingArrivalEvents.status })
    .from(bookingArrivalEvents)
    .innerJoin(bookings, eq(bookings.id, bookingArrivalEvents.bookingId))
    .where(
      and(
        eq(bookingArrivalEvents.shopId, shopId),
        eq(bookingArrivalEvents.tripId, tripId),
        eq(bookingArrivalEvents.bookingId, bookingId),
        sinceSeatReopened,
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

/**
 * The trail's newest word for the `bookings` row of the surrounding query is
 * `arrived`. Correlated on the seat's own shop, departure and id, so a seat
 * moved to another departure does not carry an arrival from the first one.
 * Rides `booking_arrival_events_shop_trip_booking_occurred_idx`.
 *
 * Only usable in a query whose `from` or join is the unaliased `bookings`. On
 * its own it is the raw sighting (`hasArrived`), whatever the seat's status:
 * the recap's logbook sheet reads it that way, beside its own row.
 */
export const deskTrailSaysArrived = sql<boolean>`coalesce((
  select ${bookingArrivalEvents.status} = 'arrived'
  from ${bookingArrivalEvents}
  where ${bookingArrivalEvents.shopId} = ${bookings.shopId}
    and ${bookingArrivalEvents.tripId} = ${bookings.tripId}
    and ${bookingArrivalEvents.bookingId} = ${bookings.id}
    and ${sinceSeatReopened}
  order by ${bookingArrivalEvents.occurredAt} desc, ${bookingArrivalEvents.createdAt} desc, ${bookingArrivalEvents.seq} desc
  limit 1
), false)`;

/**
 * **Checked in**, as SQL over the surrounding query's `bookings` row: the seat
 * is still held (`booked`) and the desk's trail has the person seen. A
 * released or cancelled seat keeps its `arrived` row standing and is not
 * checked in. `isCheckedIn` (src/lib/presence.ts) is the same rule over values
 * already read; the two must agree.
 *
 * Usable as a selected column or a `where` clause.
 */
export const seatCheckedIn = sql<boolean>`(${bookings.status} = 'booked' and ${deskTrailSaysArrived})`;
