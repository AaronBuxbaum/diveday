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
    .orderBy(asc(bookings.createdAt));
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
