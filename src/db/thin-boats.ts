import { and, asc, count, eq, gt, lte } from "drizzle-orm";
import { sellableSeats } from "@/lib/boat-safety";
import {
  THIN_BOATS_HORIZON_MS,
  THIN_BOATS_SHOWN,
  type ThinBoatNeed,
  thinBoatDealOpen,
  thinBoatNeed,
} from "@/lib/thin-boats";
import type { DbExecutor } from "./client";
import { queryAll } from "./query-helpers";
import { bookings, shops, trips } from "./schema";
import { liveTrip, notRehearsal } from "./trips-live";
import {
  liveBookingJoin,
  tripAssignedCrewCount,
  tripBoatCapacity,
  tripBoatCertifiedPassengers,
} from "./trips-queries";

export type ThinBoat = {
  tripId: string;
  title: string;
  startsAt: Date;
  booked: number;
  capacity: number;
  need: ThinBoatNeed;
  /**
   * "Invite past divers" has someone to suggest: a fun dive with a site. A
   * course session never offers it (dive-domain review F2): the people who
   * dived its site are certified divers, the least likely to want the course.
   */
  invitesPastDivers: boolean;
  /** A course session: its door points at the course ladder instead. */
  isCourseSession: boolean;
  /** Close enough to sailing for "Send a last-minute deal" (`thinBoatDealOpen`). */
  dealOpen: boolean;
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
  // The deal door is the last-minute list's: a shop that switched the list
  // off on the Features page sends no deals (`shops.last_minute_list_enabled`).
  // The invite door is past-diver invites' (`shops.past_diver_invites_enabled`).
  const switchesRead = async () =>
    (
      await db
        .select({ deals: shops.lastMinuteListEnabled, invites: shops.pastDiverInvitesEnabled })
        .from(shops)
        .where(eq(shops.id, shopId))
    )[0] ?? { deals: false, invites: false };
  const [switches, rows] = await queryAll(db, [
    switchesRead,
    () =>
      db
        .select({
          id: trips.id,
          title: trips.title,
          startsAt: trips.startsAt,
          capacity: trips.capacity,
          minimumBookings: trips.minimumBookings,
          minimumDecisionHours: trips.minimumDecisionHours,
          diveSiteId: trips.diveSiteId,
          courseId: trips.courseId,
          certifiedPassengers: tripBoatCertifiedPassengers(),
          boatCapacity: tripBoatCapacity(),
          assignedCrewCount: tripAssignedCrewCount(),
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
        .orderBy(asc(trips.startsAt), asc(trips.title), asc(trips.id)),
  ]);

  const thin = rows.flatMap((row) => {
    const capacity = sellableSeats(
      row.capacity,
      row.certifiedPassengers,
      row.boatCapacity,
      row.assignedCrewCount,
    );
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
            invitesPastDivers: switches.invites && row.diveSiteId !== null && row.courseId === null,
            isCourseSession: row.courseId !== null,
            dealOpen: switches.deals && thinBoatDealOpen(row.startsAt, now),
          },
        ]
      : [];
  });
  return { shown: thin.slice(0, limit), total: thin.length };
}
