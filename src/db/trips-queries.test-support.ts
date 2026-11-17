import { and, asc, count, eq, gte } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { DEPARTURE_BUFFER_MS } from "@/lib/departure-clock";
import type { AppDb } from "./client";
import { bookings, courses, diveSites, trips } from "./schema";
import { tripPrimarySiteId } from "./trip-primary-site";
import { liveTrip } from "./trips-live";
import {
  boardCourseColumns,
  boardDiveSiteColumns,
  bookedDiversCount,
  liveBookingJoin,
  type TripWithBookedCount,
  tripAssignedCrewCount,
  tripBoatCapacity,
  tripBoatCertifiedPassengers,
  withSellableCapacity,
} from "./trips-queries";

/**
 * Upcoming scheduled trips with their active-booking counts.
 * Cancelled bookings free the spot; every other status holds one.
 *
 * Test fixture: an unbounded whole-schedule read, kept out of product code (the board pages
 * with `pagedUpcomingTripsWithCounts`).
 */
export async function upcomingTripsWithCounts(
  db: AppDb,
  shopId: string,
  now: Date = nowDate(),
): Promise<TripWithBookedCount[]> {
  const rows = await db
    .select({
      trip: trips,
      course: boardCourseColumns,
      diveSite: boardDiveSiteColumns,
      booked: count(bookings.id),
      bookedDivers: bookedDiversCount(),
      certifiedPassengers: tripBoatCertifiedPassengers(),
      boatCapacity: tripBoatCapacity(),
      assignedCrewCount: tripAssignedCrewCount(),
    })
    .from(trips)
    .leftJoin(courses, eq(courses.id, trips.courseId))
    .leftJoin(diveSites, eq(diveSites.id, tripPrimarySiteId))
    .leftJoin(bookings, liveBookingJoin)
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        gte(trips.startsAt, new Date(now.getTime() - DEPARTURE_BUFFER_MS)),
      ),
    )
    .groupBy(trips.id, courses.id, diveSites.id)
    // The paged board's own order, so the two never disagree over same-minute boats.
    .orderBy(asc(trips.startsAt), asc(trips.title), asc(trips.id));

  return rows.map(
    ({
      trip,
      course,
      diveSite,
      booked,
      bookedDivers,
      certifiedPassengers,
      boatCapacity,
      assignedCrewCount,
    }) => ({
      ...withSellableCapacity(trip, certifiedPassengers, boatCapacity, assignedCrewCount),
      course,
      diveSite,
      booked,
      bookedDivers,
    }),
  );
}
