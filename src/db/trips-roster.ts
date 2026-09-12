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
 * decoration.** `created_at` alone was never a total order. `createBooking`
 * stamps the application clock, and that clock is frozen for the unit fleet
 * and for e2e, so **every booking the app writes during a test run carries one
 * instant** — two divers seated in a spec, or a party booked in a single
 * `createBookingParty` transaction, tie *by construction* rather than by bad
 * luck. (Most seeded bookings do not: `nextCreatedAt` in `seed-clock.ts`
 * exists to give them distinct stamps, and the seeds use it.
 * `seed-year-band.ts` is the one that stamps none.) A roster is read at the
 * rail; it does not get to be nondeterministic.
 *
 * The tie-break used to be `asc(bookings.id)`, and that was the wrong half of
 * the promise (issue #1720). A `defaultRandom()` uuid makes one database
 * answer the same way every time — and it was immune to a name edit, which
 * this key is not: correcting a walk-up's name re-orders that diver inside
 * their own tie group, so a sheet printed at 06:40 and the screen at 06:55 can
 * put a different body at 05. That trade is deliberate and bounded to one
 * party-sized block, and the number was **already** a position rather than an
 * identity — a cancellation or a resold released seat re-numbers everything
 * below it. What the order is stable against is a re-read and a fresh seed of
 * the same data. See the glossary's *Roll-call order* and issue #1759. The
 * uuid is arbitrary, it is
 * different in every freshly seeded database, and it is unexplainable to the
 * person reading the list. The index of this array **is** the rail numbering:
 * `DiverRollCall.tsx` and the departure log both render
 * `String(index + 1).padStart(2, "0")` straight off it. "01" deciding itself
 * by coin flip per seed is how six unchanged visual captures came to need a
 * hand review on every pull request (issue #1720, reproduced on #1739), and it
 * is the same defect `arrival-provenance.ts` was reviewed for on 2026-09-11.
 *
 * ADR 20260815-roll-call-order-is-a-property-of-the-data already says of the
 * key that was here: "**Order by `id`** — `defaultRandom()`, so arbitrary,
 * merely arbitrary consistently." That ADR is cited for *that* sentence and
 * nothing more — it is about ordering the append-only roll-call trail by a
 * monotonic `seq`, it never mentions `bookings` or this query, and `bookings`
 * is a mutable row rather than a trail, so its prescription does not transfer
 * here by category. A monotonic column on `bookings` would have worked too;
 * this change deliberately does not add one.
 *
 * `people.full_name` is the replacement because it is a property of the data,
 * reproducible anywhere the same divers are on the same boat, and — the real
 * argument — because the second of the two people calling the roll can find a
 * called name in one pass down a name-ordered list and can *see* a skip. On an
 * arbitrarily-ordered list they must scan every row for every name, which is
 * how the second check quietly stops happening. It is **not** the order a
 * person would have written the list in themselves: `full_name` is one free
 * text box whose entry convention is not a fact (`src/db/schema.ts` records
 * that rows arrive as "Tanaka Keiko" and as "Smith, John"), so this sorts on
 * whichever token happens to be first. Never call the manifest alphabetical in
 * staff copy — a crew would search it that way and conclude a diver is
 * missing. The column carries `COLLATE "und-x-icu"`
 * (`drizzle/20260911200158_person-name-collation`), so this inherits an
 * ordering sensible in any language without the query saying so — `Ángel`
 * beside `Ana`, not after `Zoe`.
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
