import { and, asc, eq, isNull, ne } from "drizzle-orm";
import type { AppDb } from "./client";
import { bookings, people, tripWaitlistEntries } from "./schema";

/**
 * Who is *on* a departure: booked divers, the wait list behind them, and the
 * contact addresses for the seats currently held.
 *
 * `bookings` and `trip_waitlist_entries` both carry their own `shop_id`
 * (CR-007), so every read here filters on it directly rather than joining
 * through `trips` — none of these can be called safely with only a trip UUID
 * for the wrong shop.
 */

/** Email recipients holding active seats on one tenant-scoped trip. */
export async function listTripDiverContacts(db: AppDb, shopId: string, tripId: string) {
  return db
    .select({ fullName: people.fullName, email: people.email })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, tripId),
        ne(bookings.status, "cancelled"),
        isNull(people.deletedAt),
      ),
    );
}

/**
 * Divers on a trip: non-cancelled bookings with their people, oldest first.
 * `bookings` carries its own `shop_id` (CR-007) — filtered directly rather
 * than joined through `trips`, so this can never be called safely with only
 * a trip UUID for the wrong shop.
 *
 * **Ordered by seat time, then by the diver's name, and neither key is
 * decoration.** `created_at` alone was never a total order: Postgres stamps a
 * whole seeding transaction with one instant, so every seeded diver on a
 * departure already shared it and this list's order fell out of whatever the
 * heap returned. Since `createBooking` stamps the application clock — frozen
 * outright under the e2e harness — two divers seated in one spec, or in one
 * request, share that instant *by construction* rather than by bad luck. A
 * roster is read at the rail; it does not get to be nondeterministic.
 *
 * The tie-break used to be `asc(bookings.id)`, and that was the wrong half of
 * the promise (issue #1720). A `defaultRandom()` uuid makes one database
 * answer the same way every time — so nothing reorders under a crew member and
 * a printed copy cannot disagree with the screen — but it is arbitrary, it is
 * different in every freshly seeded database, and it is unexplainable to the
 * person reading the list. The index of this array **is** the rail numbering:
 * `DiverRollCall.tsx` and the departure log both render
 * `String(index + 1).padStart(2, "0")` straight off it. "01" deciding itself
 * by coin flip per seed is how six unchanged visual captures came to need a
 * hand review on every pull request (issue #1720, reproduced on #1739), and it
 * is the same defect `arrival-provenance.ts` was reviewed for on 2026-09-11.
 *
 * `people.full_name` is the replacement because it is a property of the data
 * (ADR 20260815-roll-call-order-is-a-property-of-the-data), reproducible
 * anywhere the same divers are on the same boat, and the order a person would
 * have written the list in themselves. The column carries `COLLATE "und-x-icu"`
 * (`drizzle/20260911200158_person-name-collation`), so this inherits an
 * ordering that is sensible in any language without the query saying so —
 * `Ángel` beside `Ana`, not after `Zoe`.
 *
 * Seat time stays *above* the name: the roster is still oldest-seat-first, and
 * a diver added at the counter this morning does not jump the queue by being
 * called Adler. `asc(bookings.id)` stays *below* it, as the last resort that
 * keeps this a total order for two identically-named divers seated in one
 * instant — the one case where no meaningful key is left.
 *
 * `export.ts`, `seat-claims.ts`, `season-scale.ts`, `first-booking.ts` and
 * `waivers.ts` still break this tie on `bookings.id`; #1720 left them where
 * they were rather than reordering a CSV and five surfaces in a change about
 * the manifest.
 */
export async function getTripRoster(db: AppDb, shopId: string, tripId: string) {
  return db
    .select({ booking: bookings, person: people })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookings.tripId, tripId),
        eq(bookings.shopId, shopId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .orderBy(asc(bookings.createdAt), asc(people.fullName), asc(bookings.id));
}

/**
 * Wait-list entries stay outside the roster because they have not booked a
 * seat. `trip_waitlist_entries` carries its own `shop_id` (CR-007).
 */
export async function getTripWaitlist(db: AppDb, shopId: string, tripId: string) {
  return db
    .select({ entry: tripWaitlistEntries, person: people })
    .from(tripWaitlistEntries)
    .innerJoin(people, eq(people.id, tripWaitlistEntries.personId))
    .where(and(eq(tripWaitlistEntries.tripId, tripId), eq(tripWaitlistEntries.shopId, shopId)))
    .orderBy(asc(tripWaitlistEntries.createdAt));
}

/**
 * Confirmation pages render only a real entry, never an identity in the URL.
 * `trip_waitlist_entries` carries its own `shop_id` (CR-007).
 */
export async function getWaitlistEntryForTrip(
  db: AppDb,
  shopId: string,
  tripId: string,
  entryId: string,
) {
  const [row] = await db
    .select({ entry: tripWaitlistEntries, person: people })
    .from(tripWaitlistEntries)
    .innerJoin(people, eq(people.id, tripWaitlistEntries.personId))
    .where(
      and(
        eq(tripWaitlistEntries.id, entryId),
        eq(tripWaitlistEntries.tripId, tripId),
        eq(tripWaitlistEntries.shopId, shopId),
      ),
    )
    .limit(1);
  return row ?? null;
}
