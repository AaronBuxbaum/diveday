import { and, asc, desc, eq, inArray, isNull, lt, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { DbExecutor } from "./client";
import { bookings, people, recapPhotos, trips } from "./schema";
import { HISTORY_DIVER_NAMES } from "./seed-history";
import { commonsImage } from "./seed-images";
import { liveTrip } from "./trips-live";

/** A history-only diver shares a bundled photo on a different boat from the pinned recap. */
export async function seedSharedDemoRecapPhoto(
  db: DbExecutor,
  shopId: string,
  primaryTripId: string,
): Promise<void> {
  const now = nowDate();
  const [seat] = await db
    .select({ bookingId: bookings.id, tripId: trips.id })
    .from(bookings)
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId)))
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, shopId)))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.status, "checked_in"),
        isNull(bookings.identityUnconfirmedAt),
        inArray(people.fullName, [...HISTORY_DIVER_NAMES]),
        ne(trips.id, primaryTripId),
        eq(trips.status, "scheduled"),
        lt(trips.endsAt, now),
        liveTrip(),
      ),
    )
    .orderBy(desc(trips.endsAt), asc(trips.title), asc(people.fullName), asc(bookings.id))
    .limit(1);
  if (!seat) throw new Error("seed: no completed secondary recap booking");
  await db.insert(recapPhotos).values({
    shopId,
    bookingId: seat.bookingId,
    tripId: seat.tripId,
    imageUrl: commonsImage("French Angelfish Molasses Reef 20080309.jpg"),
    caption: null,
    sharedWithBoatAt: now,
    createdAt: now,
  });
}
