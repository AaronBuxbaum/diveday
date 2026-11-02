import { and, eq, gte, isNull } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { markBookingRunningLate } from "@/db/running-late";
import { bookings, people, trips } from "@/db/schema";

/**
 * Priya Sharma, booked on a departure inside the next day, says she
 * is running late twelve minutes before the frozen clock — through the one
 * writer every real door uses, so the window rule holds here too.
 */
export async function sayPriyaIsRunningLate(
  db: AppDb,
  shopId: string,
  now: Date,
): Promise<{ tripId: string; bookingId: string } | null> {
  const [seat] = await db
    .select({ bookingId: bookings.id, tripId: trips.id })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(people.fullName, "Priya Sharma"),
        eq(bookings.status, "booked"),
        eq(trips.status, "scheduled"),
        isNull(trips.deletedAt),
        gte(trips.startsAt, now),
      ),
    )
    .orderBy(trips.startsAt)
    .limit(1);
  if (!seat) return null;
  const said = await markBookingRunningLate(db, {
    shopId,
    bookingId: seat.bookingId,
    now: new Date(now.getTime() - 12 * 60 * 1000),
  });
  return said.status === "closed" ? null : seat;
}
