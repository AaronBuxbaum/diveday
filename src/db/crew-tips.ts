import { and, asc, count, eq, gte, inArray, isNull, lt, lte, or, sql, sum } from "drizzle-orm";
import { splitTipsEqually } from "@/lib/crew-sheet";
import type { DbExecutor } from "./client";
import { queryAll } from "./query-helpers";
import {
  boats,
  bookings,
  executedDives,
  tips,
  tripAssignments,
  tripDives,
  tripScheduleDays,
  trips,
} from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **Tips, seen from the boat** (UX review 2026-10-11, item 18). A diver tips
 * "the crew" and the money goes to the shop, which passes it on; these two
 * reads are how the app shows that promise being kept. Paid tips only,
 * anchored to the departure the tip was left for, on the same basis as the
 * crew sheet (`src/db/crew-sheet.ts`) and Reports' tips figure.
 */

/**
 * **The reader's own share** of the paid tips on the departures they crewed
 * that left inside the window: a crew member's "Your share of tips this
 * week" (issue #2468). Each departure's tips are split equally across its
 * whole crew by `splitTipsEqually`, the rule the crew sheet prints, and the
 * reader's piece of each is added up. Two crew on one boat each read half, so
 * neither mistakes the boat's total for their own. How the shop actually
 * divides tips is the shop's; this is the same estimate the crew sheet makes,
 * and it is not payroll.
 *
 * Only departures the reader crewed are read, and nothing else about money
 * leaves this function (decision H-20261015-crew-see-tips-on: crew see tips on their own boats and
 * no other shop money).
 */
export async function crewTipShare(
  db: DbExecutor,
  shopId: string,
  personId: string,
  window: { from: Date; to: Date },
): Promise<number> {
  const mine = await db
    .select({ tripId: trips.id, total: sum(tips.amountCents) })
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
    )
    .groupBy(trips.id);
  if (mine.length === 0) return 0;
  const crew = await db
    .select({ tripId: tripAssignments.tripId, personId: tripAssignments.personId })
    .from(tripAssignments)
    .where(
      inArray(
        tripAssignments.tripId,
        mine.map((row) => row.tripId),
      ),
    );
  const crewByTrip = new Map<string, string[]>();
  for (const member of crew) {
    const members = crewByTrip.get(member.tripId);
    if (members) members.push(member.personId);
    else crewByTrip.set(member.tripId, [member.personId]);
  }
  let share = 0;
  for (const row of mine) {
    const split = splitTipsEqually(Number(row.total ?? 0), crewByTrip.get(row.tripId) ?? []);
    share += split.get(personId) ?? 0;
  }
  return share;
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
 * boat still out is not counted yet. A departure counts only if it ran: still
 * `scheduled`, or called off after the crew logged a live dive on it (the
 * desk's half of the dive-day rule, `deskCountsDiveDay`). Its dives are the
 * live ones the crew logged (`executed_dives`) and, where nobody logged any,
 * the ones it planned: dives the boat *ran*, which the copy says, never dives
 * this person made, since a captain stays dry. Its time is the departure's
 * scheduled days where it has them (`trip_schedule_days`, so a liveaboard is
 * not its nights), else its own span, dock to dock (dive-domain review of
 * layer r5-4, fix 3 and note 10). The crew's working record, not a diver
 * logbook (loop 6, DB14 stays declined).
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
        or(
          eq(trips.status, "scheduled"),
          sql`exists (select 1 from ${executedDives} where ${executedDives.tripId} = ${trips.id} and ${executedDives.shopId} = ${trips.shopId} and ${executedDives.deletedAt} is null)`,
        ),
      ),
    );
  if (crewed.length === 0) return { boats: 0, dives: 0, minutes: 0 };
  const ids = crewed.map((trip) => trip.id);
  const [logged, planned, scheduleDays] = await queryAll(db, [
    () =>
      db
        .select({ tripId: executedDives.tripId, dives: count() })
        .from(executedDives)
        .where(
          and(
            eq(executedDives.shopId, shopId),
            inArray(executedDives.tripId, ids),
            isNull(executedDives.deletedAt),
          ),
        )
        .groupBy(executedDives.tripId),
    () =>
      db
        .select({ tripId: tripDives.tripId, dives: count() })
        .from(tripDives)
        .where(inArray(tripDives.tripId, ids))
        .groupBy(tripDives.tripId),
    () =>
      db
        .select({
          tripId: tripScheduleDays.tripId,
          minutes: sql<number>`sum(extract(epoch from (${tripScheduleDays.endsAt} - ${tripScheduleDays.startsAt})) / 60)`,
        })
        .from(tripScheduleDays)
        .where(inArray(tripScheduleDays.tripId, ids))
        .groupBy(tripScheduleDays.tripId),
  ]);
  const loggedBy = new Map(logged.map((row) => [row.tripId, Number(row.dives)]));
  const plannedBy = new Map(planned.map((row) => [row.tripId, Number(row.dives)]));
  const scheduledBy = new Map(scheduleDays.map((row) => [row.tripId, Number(row.minutes)]));
  let dives = 0;
  let minutes = 0;
  for (const trip of crewed) {
    dives += loggedBy.get(trip.id) || plannedBy.get(trip.id) || 0;
    minutes += Math.round(
      scheduledBy.get(trip.id) ?? (trip.endsAt.getTime() - trip.startsAt.getTime()) / 60_000,
    );
  }
  return { boats: crewed.length, dives, minutes };
}
