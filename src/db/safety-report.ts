import { and, asc, count, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import {
  type SafetyCrewMember,
  type SafetyMonth,
  type SafetyYear,
  summarizeSafetyMonth,
  summarizeSafetyYear,
} from "@/lib/safety-report";
import { hasReturned } from "@/lib/trips";
import { shopMonthBounds } from "@/lib/zoned";
import type { DbExecutor } from "./client";
import { queryAll } from "./query-helpers";
import {
  activityEvents,
  bookings,
  people,
  personRoles,
  rollCallCrewEvents,
  rollCallEvents,
  tripAssignments,
  trips,
} from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **The Safety tab's month, read from existing records** (ADR
 * 20261012-incident-reports). No new tracking: roll call, the crew list, the
 * staff credentials and the activity trail are all read as they stand, and
 * `summarizeSafetyMonth` (src/lib/safety-report.ts) does the counting.
 *
 * The departures are the ones that **left in the period and are home**
 * (`hasReturned`): a boat still out has a count that is not due yet, and
 * calling it open would be a figure that changes by the hour.
 *
 * Owner/manager reading. The page gates it; this reads only `shopId`'s rows.
 */
export async function getSafetyMonth(
  db: DbExecutor,
  shopId: string,
  from: Date,
  to: Date,
  timeZone: string,
  now: Date = nowDate(),
): Promise<SafetyMonth> {
  const tripRows = (
    await db
      .select({
        id: trips.id,
        title: trips.title,
        startsAt: trips.startsAt,
        endsAt: trips.endsAt,
        plannedDives: trips.plannedDives,
        diveMode: trips.diveMode,
      })
      .from(trips)
      .where(
        and(
          liveTrip(),
          eq(trips.shopId, shopId),
          eq(trips.status, "scheduled"),
          gte(trips.startsAt, from),
          lt(trips.startsAt, to),
        ),
      )
      .orderBy(asc(trips.startsAt), asc(trips.title), asc(trips.id))
  ).filter((trip) => hasReturned(trip.endsAt, now));
  // An occurrence nobody booked and nobody counted is passed over in
  // `summarizeSafetyMonth`, as Today passes it over.
  const tripIds = tripRows.map((trip) => trip.id);

  const [certOverrideRow] = await db
    .select({ n: count() })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.shopId, shopId),
        eq(activityEvents.code, "participant_type_changed"),
        sql`${activityEvents.params}->>'certCheck' = 'overridden'`,
        gte(activityEvents.occurredAt, from),
        lt(activityEvents.occurredAt, to),
      ),
    );
  const certOverrides = certOverrideRow?.n ?? 0;

  if (tripIds.length === 0) {
    return summarizeSafetyMonth({
      timeZone,
      departures: [],
      diverEvents: [],
      crewEvents: [],
      credentials: [],
      personNames: new Map(),
      certOverrides,
    });
  }

  const [roster, crew, diverEvents, crewEvents] = await queryAll(db, [
    () =>
      db
        .select({ tripId: bookings.tripId, bookingId: bookings.id })
        .from(bookings)
        .where(
          and(
            eq(bookings.shopId, shopId),
            inArray(bookings.tripId, tripIds),
            ne(bookings.status, "cancelled"),
          ),
        ),
    () =>
      db
        .select({
          tripId: tripAssignments.tripId,
          personId: tripAssignments.personId,
          tripRole: tripAssignments.tripRole,
        })
        .from(tripAssignments)
        .innerJoin(people, eq(people.id, tripAssignments.personId))
        .where(and(inArray(tripAssignments.tripId, tripIds), eq(people.shopId, shopId))),
    () =>
      db
        .select({
          tripId: rollCallEvents.tripId,
          subjectId: rollCallEvents.bookingId,
          checkpoint: rollCallEvents.checkpoint,
          status: rollCallEvents.status,
        })
        .from(rollCallEvents)
        // A seat cancelled after the boat left keeps its events; they must not
        // answer for a roster it is no longer on (as `listRollCallGaps` reads).
        .innerJoin(
          bookings,
          and(eq(bookings.id, rollCallEvents.bookingId), ne(bookings.status, "cancelled")),
        )
        .where(and(eq(rollCallEvents.shopId, shopId), inArray(rollCallEvents.tripId, tripIds)))
        .orderBy(
          asc(rollCallEvents.occurredAt),
          asc(rollCallEvents.createdAt),
          asc(rollCallEvents.seq),
        ),
    () =>
      db
        .select({
          tripId: rollCallCrewEvents.tripId,
          subjectId: rollCallCrewEvents.personId,
          checkpoint: rollCallCrewEvents.checkpoint,
          status: rollCallCrewEvents.status,
        })
        .from(rollCallCrewEvents)
        .where(
          and(eq(rollCallCrewEvents.shopId, shopId), inArray(rollCallCrewEvents.tripId, tripIds)),
        )
        .orderBy(
          asc(rollCallCrewEvents.occurredAt),
          asc(rollCallCrewEvents.createdAt),
          asc(rollCallCrewEvents.seq),
        ),
  ]);

  const crewIds = [...new Set(crew.map((row) => row.personId))];
  const [names, shopRoleRows] = crewIds.length
    ? await queryAll(db, [
        () =>
          db
            .select({ id: people.id, fullName: people.fullName })
            .from(people)
            // diveday:allow-deleted-people: names for crew already on these trips; removed or not, they were aboard.
            .where(and(eq(people.shopId, shopId), inArray(people.id, crewIds))),
        // The standing roles, which name the job when the roster does not.
        () =>
          db
            .select({ personId: personRoles.personId, role: personRoles.role })
            .from(personRoles)
            .innerJoin(people, eq(people.id, personRoles.personId))
            .where(and(eq(people.shopId, shopId), inArray(personRoles.personId, crewIds))),
      ])
    : [[], []];

  const bookingsByTrip = new Map<string, string[]>();
  for (const row of roster) {
    const list = bookingsByTrip.get(row.tripId) ?? [];
    list.push(row.bookingId);
    bookingsByTrip.set(row.tripId, list);
  }
  const shopRolesByPerson = new Map<string, string[]>();
  for (const row of shopRoleRows) {
    const list = shopRolesByPerson.get(row.personId) ?? [];
    list.push(row.role);
    shopRolesByPerson.set(row.personId, list);
  }
  const crewByTrip = new Map<string, SafetyCrewMember[]>();
  for (const row of crew) {
    const list = crewByTrip.get(row.tripId) ?? [];
    list.push({
      personId: row.personId,
      tripRole: row.tripRole,
      shopRoles: shopRolesByPerson.get(row.personId) ?? [],
    });
    crewByTrip.set(row.tripId, list);
  }

  return summarizeSafetyMonth({
    timeZone,
    departures: tripRows.map((trip) => ({
      tripId: trip.id,
      title: trip.title,
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      plannedDives: trip.plannedDives,
      diveMode: trip.diveMode,
      bookingIds: bookingsByTrip.get(trip.id) ?? [],
      crew: crewByTrip.get(trip.id) ?? [],
    })),
    diverEvents,
    crewEvents,
    // Recorded transaction times do not prove commit before departure.
    credentials: [],
    unavailableCredentialPeople: new Set(crewIds),
    personNames: new Map(names.map((row) => [row.id, row.fullName])),
    certOverrides,
  });
}

/**
 * **The Safety year** (fifth loop, item 33; dive-domain review F1): each month
 * of `year` read as its own month view reads it, folded by
 * `summarizeSafetyYear`, so the year is the sum of the twelve pages it
 * stands for. Months after `now` have nothing back and are not read. One
 * month at a time: twelve reads of one shop, never concurrent on one
 * executor.
 */
export async function getSafetyYear(
  db: DbExecutor,
  shopId: string,
  year: number,
  timeZone: string,
  now: Date = nowDate(),
): Promise<SafetyYear> {
  const months: SafetyMonth[] = [];
  for (let month = 1; month <= 12; month++) {
    const { from, to } = shopMonthBounds({ year, month }, timeZone);
    if (from >= now) break;
    months.push(await getSafetyMonth(db, shopId, from, to, timeZone, now));
  }
  return summarizeSafetyYear(months);
}
