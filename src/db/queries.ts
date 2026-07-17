import { and, asc, count, eq, gte, ne } from "drizzle-orm";
import type { AppDb } from "./client";
import { bookings, shops, trips } from "./schema";

export async function getShopBySlug(db: AppDb, slug: string) {
  const [shop] = await db.select().from(shops).where(eq(shops.slug, slug)).limit(1);
  return shop ?? null;
}

export type TripWithBookedCount = typeof trips.$inferSelect & { booked: number };

/**
 * Upcoming scheduled trips with their active-booking counts.
 * Cancelled bookings free the spot; every other status holds one.
 */
export async function upcomingTripsWithCounts(
  db: AppDb,
  shopId: string,
  now: Date = new Date(),
): Promise<TripWithBookedCount[]> {
  const rows = await db
    .select({
      trip: trips,
      booked: count(bookings.id),
    })
    .from(trips)
    .leftJoin(bookings, and(eq(bookings.tripId, trips.id), ne(bookings.status, "cancelled")))
    .where(and(eq(trips.shopId, shopId), eq(trips.status, "scheduled"), gte(trips.startsAt, now)))
    .groupBy(trips.id)
    .orderBy(asc(trips.startsAt));

  return rows.map(({ trip, booked }) => ({ ...trip, booked }));
}
