/**
 * Waivers: each booking's waiver status on one departure or several, as the
 * rosters read it. Imported through the `./waivers` barrel.
 */
import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { bookings, people, waiverRecords } from "./schema";

/**
 * Staff roster view: only the current record joins each active booking. The
 * single-trip form of `listTripsWaiverStatuses` below — one query, one rule,
 * so the two can never disagree about which record is current.
 */
export async function listTripWaiverStatuses(db: DbExecutor, shopId: string, tripId: string) {
  return listTripsWaiverStatuses(db, shopId, [tripId]);
}

/**
 * Staff roster view: only the current record joins each active booking across
 * multiple trips.
 *
 * **Ordered exactly as `getTripRoster` is** — seat time, then the diver's
 * name, then the booking id as the last resort (issue #1753). The divergence
 * this docblock used to record is closed: two readers of one roster answering
 * in two different orders is a trap for whoever next renders these rows
 * directly.
 *
 * Be precise about what the old `asc(bookings.id)` cost, because the
 * overstatement that was here — "a list a staffer works down" — was not true.
 * **No surface observes this array's order.** Every consumer re-keys it by
 * booking id: `listTripsReadiness` builds `readinessByBooking` /
 * `depthByBooking` maps from it, the trip page's `WaiverByBooking` is a `Map`,
 * the Guests tab hangs waiver detail off the roster's own spine
 * (`trips-guests.ts`), and the requirements action reduces it to a count. So
 * nobody — a staffer, a capture, or a diff — can see the tie broken either
 * way today.
 *
 * What the id key cost was the *contract*: `bookings.created_at` is not a
 * total order (`createBooking` stamps the application clock, frozen for the
 * unit fleet and for e2e, so a party booked in one transaction and every
 * booking a spec writes tie by construction), and `bookings.id` is a
 * `defaultRandom()` uuid, so the documented order was "seat time, then
 * whichever uuid the database happened to mint" — unpredictable to a reader
 * and different in every freshly seeded database. `people.full_name` carries
 * `COLLATE "und-x-icu"` (`drizzle/20260911200158_person-name-collation`), so
 * the name key is locale-sensible without the query saying so.
 */
export async function listTripsWaiverStatuses(db: DbExecutor, shopId: string, tripIds: string[]) {
  if (tripIds.length === 0) return [];
  return db
    .select({ booking: bookings, person: people, waiver: waiverRecords })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .leftJoin(
      waiverRecords,
      and(eq(waiverRecords.bookingId, bookings.id), isNull(waiverRecords.supersededAt)),
    )
    .where(
      and(
        eq(bookings.shopId, shopId),
        inArray(bookings.tripId, tripIds),
        ne(bookings.status, "cancelled"),
      ),
    )
    .orderBy(asc(bookings.createdAt), asc(people.fullName), asc(bookings.id));
}
