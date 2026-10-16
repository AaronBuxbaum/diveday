import { and, asc, count, eq, gte, inArray, lt, lte, sum } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { queryAll } from "./query-helpers";
import { boats, bookings, executedDives, tips, tripAssignments, tripDives, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **Tips, seen from the boat** (UX review 2026-10-11, item 18). A diver tips
 * "the crew" and the money goes to the shop, which passes it on; these two
 * reads are how the app shows that promise being kept. Paid tips only,
 * anchored to the departure the tip was left for, on the same basis as the
 * crew sheet (`src/db/crew-sheet.ts`) and Reports' tips figure.
 */

/**
 * Paid tips on the departures this person crewed that left inside the window:
 * a crew member's "Your boats earned $140 in tips this week". The boat's
 * whole tip total, not a share of it: how the shop splits it is the shop's
 * (the crew sheet carries one way to split it, and says it is not payroll).
 */
export async function crewTipsOnBoats(
  db: DbExecutor,
  shopId: string,
  personId: string,
  window: { from: Date; to: Date },
): Promise<number> {
  const [row] = await db
    .select({ total: sum(tips.amountCents) })
    .from(tips)
    .innerJoin(bookings, and(eq(bookings.id, tips.bookingId), eq(bookings.shopId, shopId)))
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId)))
    .innerJoin(
      tripAssignments,
      and(eq(tripAssignments.tripId, trips.id), eq(tripAssignments.personId, personId)),
    )
    .where(
      and(
        liveTrip(),
        eq(tips.shopId, shopId),
        eq(tips.status, "paid"),
        gte(trips.startsAt, window.from),
        lt(trips.startsAt, window.to),
      ),
    );
  return Number(row?.total ?? 0);
}

/** One departure's paid tips, for the evening's takings. */
export type DepartureTips = {
  tripId: string;
  startsAt: Date;
  /** The boat's name when the departure has one, else the departure's title. */
  label: string;
  cents: number;
};

/**
 * Paid tips per departure that left inside the window, in clock order, and
 * only departures that took any: Close-out's per-boat line under "And $140 in
 * tips."
 */
export async function tipsByDeparture(
  db: DbExecutor,
  shopId: string,
  window: { from: Date; to: Date },
): Promise<DepartureTips[]> {
  const rows = await db
    .select({
      tripId: trips.id,
      startsAt: trips.startsAt,
      title: trips.title,
      boatName: boats.name,
      total: sum(tips.amountCents),
    })
    .from(tips)
    .innerJoin(bookings, and(eq(bookings.id, tips.bookingId), eq(bookings.shopId, shopId)))
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId)))
    .leftJoin(boats, and(eq(boats.id, trips.boatId), eq(boats.shopId, shopId)))
    .where(
      and(
        liveTrip(),
        eq(tips.shopId, shopId),
        eq(tips.status, "paid"),
        gte(trips.startsAt, window.from),
        lt(trips.startsAt, window.to),
      ),
    )
    .groupBy(trips.id, trips.startsAt, trips.title, boats.name)
    .orderBy(asc(trips.startsAt));
  return rows
    .map((row) => ({
      tripId: row.tripId,
      startsAt: row.startsAt,
      label: row.boatName ?? row.title,
      cents: Number(row.total ?? 0),
    }))
    .filter((row) => row.cents > 0);
}

/** A crew member's month so far: boats crewed, dives, and time on the water. */
export type CrewMonth = { boats: number; dives: number; minutes: number };

/**
 * **A crew member's own season, the month line** (fifth-loop ideas, item 51):
 * "October: 14 boats · 26 dives · 31 hours on the water." Departures this
 * person crewed (`trip_assignments`) that came back inside the window, so a
 * boat still out is not counted yet. A departure's dives are the ones the crew
 * logged (`executed_dives`) and, where nobody logged any, the ones it planned;
 * its time is the departure's own span, dock to dock. The crew's working
 * record, not a diver logbook (loop 6, DB14 stays declined).
 */
export async function crewMonth(
  db: DbExecutor,
  shopId: string,
  personId: string,
  window: { from: Date; now: Date },
): Promise<CrewMonth> {
  const crewed = await db
    .select({ id: trips.id, startsAt: trips.startsAt, endsAt: trips.endsAt })
    .from(trips)
    .innerJoin(
      tripAssignments,
      and(eq(tripAssignments.tripId, trips.id), eq(tripAssignments.personId, personId)),
    )
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, shopId),
        gte(trips.startsAt, window.from),
        lte(trips.endsAt, window.now),
      ),
    );
  if (crewed.length === 0) return { boats: 0, dives: 0, minutes: 0 };
  const ids = crewed.map((trip) => trip.id);
  const [logged, planned] = await queryAll(db, [
    () =>
      db
        .select({ tripId: executedDives.tripId, dives: count() })
        .from(executedDives)
        .where(and(eq(executedDives.shopId, shopId), inArray(executedDives.tripId, ids)))
        .groupBy(executedDives.tripId),
    () =>
      db
        .select({ tripId: tripDives.tripId, dives: count() })
        .from(tripDives)
        .where(inArray(tripDives.tripId, ids))
        .groupBy(tripDives.tripId),
  ]);
  const loggedBy = new Map(logged.map((row) => [row.tripId, Number(row.dives)]));
  const plannedBy = new Map(planned.map((row) => [row.tripId, Number(row.dives)]));
  let dives = 0;
  let minutes = 0;
  for (const trip of crewed) {
    dives += loggedBy.get(trip.id) || plannedBy.get(trip.id) || 0;
    minutes += Math.round((trip.endsAt.getTime() - trip.startsAt.getTime()) / 60_000);
  }
  return { boats: crewed.length, dives, minutes };
}
