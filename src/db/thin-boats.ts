import { and, asc, count, eq, gt, lte } from "drizzle-orm";
import { sellableSeats } from "@/lib/boat-safety";
import {
  THIN_BOATS_HORIZON_MS,
  THIN_BOATS_SHOWN,
  type ThinBoatNeed,
  thinBoatNeed,
} from "@/lib/thin-boats";
import type { DbExecutor } from "./client";
import { bookings, trips } from "./schema";
import { liveTrip, notRehearsal } from "./trips-live";
import { liveBookingJoin, tripBoatCertifiedPassengers } from "./trips-queries";

export type ThinBoat = {
  tripId: string;
  title: string;
  startsAt: Date;
  booked: number;
  capacity: number;
  need: ThinBoatNeed;
  /** It has a site, so "Invite past divers" has someone to suggest. */
  hasSite: boolean;
};

/**
 * **The next two weeks' departures that could use divers**, soonest first
 * (fifth-loop ideas, item 43; the rule is `thinBoatNeed`). Public, scheduled,
 * real departures only: a private charter is not filled from a quiet day, and
 * a rehearsal is not a boat.
 */
export async function listThinBoats(
  db: DbExecutor,
  shopId: string,
  now: Date,
  limit: number = THIN_BOATS_SHOWN,
): Promise<{ shown: ThinBoat[]; total: number }> {
  const rows = await db
    .select({
      id: trips.id,
      title: trips.title,
      startsAt: trips.startsAt,
      capacity: trips.capacity,
      minimumBookings: trips.minimumBookings,
      minimumDecisionHours: trips.minimumDecisionHours,
      diveSiteId: trips.diveSiteId,
      certifiedPassengers: tripBoatCertifiedPassengers(),
      booked: count(bookings.id),
    })
    .from(trips)
    .leftJoin(bookings, liveBookingJoin)
    .where(
      and(
        eq(trips.shopId, shopId),
        liveTrip(),
        notRehearsal(),
        eq(trips.status, "scheduled"),
        eq(trips.isPrivate, false),
        gt(trips.startsAt, now),
        lte(trips.startsAt, new Date(now.getTime() + THIN_BOATS_HORIZON_MS)),
      ),
    )
    .groupBy(trips.id)
    .orderBy(asc(trips.startsAt), asc(trips.title), asc(trips.id));

  const thin = rows.flatMap((row) => {
    const capacity = sellableSeats(row.capacity, row.certifiedPassengers);
    const need = thinBoatNeed({ ...row, capacity }, now);
    return need
      ? [
          {
            tripId: row.id,
            title: row.title,
            startsAt: row.startsAt,
            booked: row.booked,
            capacity,
            need,
            hasSite: row.diveSiteId !== null,
          },
        ]
      : [];
  });
  return { shown: thin.slice(0, limit), total: thin.length };
}
