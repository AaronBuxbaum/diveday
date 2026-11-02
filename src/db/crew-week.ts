import { and, asc, eq, gte, lt, notInArray } from "drizzle-orm";
import { type CrewCall, crewCallAt } from "@/lib/dock-call";
import type { StaffGapCode } from "@/lib/staffing-week";
import type { AppDb } from "./client";
import { boats, shops, staffShifts, tripAssignments, trips } from "./schema";
import { getStaffingView } from "./staffing";
import { liveTrip } from "./trips-live";

/** How many departures "Your week" names: the next three, never a list. */
export const CREW_WEEK_LINES = 3;

/** One line of a crew member's week: the boat, when, their job, and the one thing missing. */
export type CrewWeekLine = {
  tripId: string;
  title: string;
  startsAt: Date;
  /** The hull, when the departure names one; a shore or pool day has none. */
  boatName: string | null;
  /** Their job on this sailing, or null when the roster did not say. */
  tripRole: (typeof tripAssignments.$inferSelect)["tripRole"];
  /**
   * The departure's crew gap, by the one measurement every crew surface
   * shares (`getStaffingView`'s `gapTrips`), or null when nothing is short.
   */
  gap: StaffGapCode | null;
  /**
   * When to be at the dock (item 47), and whose time it is: the shop's crew
   * time (H-20261022-crew-arrive-before-divers), else the divers' dock call, unless a shift of this person's
   * already running at that call starts earlier (`crewCallAt`); null when
   * none leads the departure.
   */
  crewCall: CrewCall | null;
};

/** How far before a departure a covering shift may start and still be read. */
const SHIFT_LOOKBACK_MS = 12 * 60 * 60 * 1000;

/**
 * **A crew member's next few departures** (the "Your week" strip on Today):
 * the scheduled, live departures between `from` and `to` that this person is
 * rostered on, soonest first, at most {@link CREW_WEEK_LINES}. Each carries the
 * gap the staffing week would draw on it, from the same pass, so the strip and
 * the roster cannot disagree about whether a boat is short.
 *
 * Shop-scoped twice over: the trip belongs to `shopId`, and the assignment is
 * this person's own. No diver's name or state is read here.
 */
export async function crewWeekFor(
  db: AppDb,
  input: {
    shopId: string;
    personId: string;
    from: Date;
    to: Date;
    diversPerDivemaster?: number;
    now?: Date;
    /** Departures the reader's page already lists, left out before the limit counts. */
    excludeTripIds?: readonly string[];
  },
): Promise<CrewWeekLine[]> {
  const rows = await db
    .select({
      tripId: trips.id,
      title: trips.title,
      startsAt: trips.startsAt,
      boatName: boats.name,
      tripRole: tripAssignments.tripRole,
    })
    .from(trips)
    .innerJoin(
      tripAssignments,
      and(eq(tripAssignments.tripId, trips.id), eq(tripAssignments.personId, input.personId)),
    )
    .leftJoin(boats, eq(boats.id, trips.boatId))
    .where(
      and(
        eq(trips.shopId, input.shopId),
        eq(trips.status, "scheduled"),
        gte(trips.startsAt, input.from),
        lt(trips.startsAt, input.to),
        liveTrip(),
        input.excludeTripIds?.length ? notInArray(trips.id, [...input.excludeTripIds]) : undefined,
      ),
    )
    .orderBy(asc(trips.startsAt), asc(trips.title), asc(trips.id))
    .limit(CREW_WEEK_LINES);
  if (rows.length === 0) return [];

  const [{ gapTrips }, [shop], shifts] = await Promise.all([
    getStaffingView(db, input.shopId, input.from, input.to, {
      diversPerDivemaster: input.diversPerDivemaster,
      now: input.now,
    }),
    db
      .select({ dockCallMinutes: shops.dockCallMinutes, crewLeadMinutes: shops.crewLeadMinutes })
      .from(shops)
      .where(eq(shops.id, input.shopId))
      .limit(1),
    // This person's own shifts around these departures: the Crew grid's word
    // for when their day starts.
    db
      .select({ startsAt: staffShifts.startsAt, endsAt: staffShifts.endsAt })
      .from(staffShifts)
      .where(
        and(
          eq(staffShifts.shopId, input.shopId),
          eq(staffShifts.personId, input.personId),
          gte(staffShifts.startsAt, new Date(input.from.getTime() - SHIFT_LOOKBACK_MS)),
          lt(staffShifts.startsAt, input.to),
        ),
      ),
  ]);
  const gaps = new Map(gapTrips.map((trip) => [trip.tripId, trip.gap]));
  return rows.map((row) => ({
    ...row,
    gap: gaps.get(row.tripId) ?? null,
    crewCall: crewCallAt(
      row.startsAt,
      {
        dockCallMinutes: shop?.dockCallMinutes ?? 0,
        crewLeadMinutes: shop?.crewLeadMinutes ?? null,
      },
      shifts,
    ),
  }));
}
