import {
  and,
  asc,
  count,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { AppDb, DbExecutor } from "./client";
import { decodeCursor, encodeCursor } from "./cursor";
import {
  bookings,
  courses,
  diveSites,
  people,
  personRoles,
  tripAssignments,
  tripScheduleDays,
  trips,
} from "./schema";

/**
 * Reading the board: the schedule lists, their aggregates, and the calendar
 * feeds — everything that answers "what is coming up" rather than "what is this
 * one departure".
 *
 * The paged reads are the ones to reach for. `upcomingTripsWithCounts` loads
 * every future trip and stays only for callers that genuinely need them all;
 * a page never should, because a busy shop's board grows without bound
 * (`pagedUpcomingTripsWithCounts` keysets it instead).
 */

/**
 * How many departures this shop has ever put on the board, cancelled or not.
 * One number with one caller in mind: the shop home's "you're bookable"
 * moment, which needs to know whether the trip that just landed is the
 * shop's first — the count right after a first creation equals exactly the
 * number just created (1, or the series size), and any earlier trip, even a
 * cancelled one, means the shop has had this moment already.
 */
export async function countShopTrips(db: DbExecutor, shopId: string): Promise<number> {
  const [row] = await db.select({ total: count() }).from(trips).where(eq(trips.shopId, shopId));
  return row?.total ?? 0;
}

export type TripWithBookedCount = typeof trips.$inferSelect & {
  booked: number;
  course: typeof courses.$inferSelect | null;
  diveSite: typeof diveSites.$inferSelect | null;
};

/**
 * Upcoming scheduled trips with their active-booking counts.
 * Cancelled bookings free the spot; every other status holds one.
 */
export async function upcomingTripsWithCounts(
  db: AppDb,
  shopId: string,
  now: Date = nowDate(),
): Promise<TripWithBookedCount[]> {
  const rows = await db
    .select({
      trip: trips,
      course: courses,
      diveSite: diveSites,
      booked: count(bookings.id),
    })
    .from(trips)
    .leftJoin(courses, eq(courses.id, trips.courseId))
    .leftJoin(diveSites, eq(diveSites.id, trips.diveSiteId))
    .leftJoin(bookings, and(eq(bookings.tripId, trips.id), ne(bookings.status, "cancelled")))
    .where(and(eq(trips.shopId, shopId), eq(trips.status, "scheduled"), gte(trips.startsAt, now)))
    .groupBy(trips.id, courses.id, diveSites.id)
    .orderBy(asc(trips.startsAt));

  return rows.map(({ trip, course, diveSite, booked }) => ({ ...trip, course, diveSite, booked }));
}

/**
 * Trip ids relevant to the offline-manifest auto-save window (see ADR
 * 20260726-shopwide-offline-manifest-priming): every scheduled trip that
 * hasn't ended yet and starts at or before `until`. Deliberately not
 * `startsAt >= now` like upcomingTripsWithCounts — a trip already underway
 * (departed, not yet ended) still needs its after-dive-checkpoint copy
 * auto-saved, which is exactly the scenario this feature exists to cover; a
 * lower-only bound would keep excluding it until someone opened its live
 * manifest by hand. Bounded by `until` in the query itself (not filtered
 * after fetching every future trip) since this is polled every five minutes
 * from every open staff tab.
 */
export async function listTripIdsInOfflineManifestWindow(
  db: AppDb,
  shopId: string,
  now: Date,
  until: Date,
): Promise<string[]> {
  const rows = await db
    .select({ id: trips.id })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        gte(trips.endsAt, now),
        lte(trips.startsAt, until),
      ),
    )
    .orderBy(asc(trips.startsAt));
  return rows.map((row) => row.id);
}

export const SCHEDULE_PAGE_SIZE = 20;

/**
 * The schedule page's list, one keyset page at a time (ordered by departure,
 * then id for a stable tiebreak). `upcomingTripsWithCounts` stays for callers
 * that genuinely need every upcoming trip in memory; the page never should —
 * a busy shop's board grows without bound.
 *
 * `monthStart`/`monthEnd` bound the page to a single shop-local month — the
 * diver calendar passes both when it's on an explicit `?month=` so the list
 * below it shows the same month instead of drifting back to "next N trips
 * from now" (the calendar/list desync this closes).
 */
export async function pagedUpcomingTripsWithCounts(
  db: AppDb,
  shopId: string,
  options: {
    cursor?: string;
    limit?: number;
    now?: Date;
    monthStart?: Date;
    monthEnd?: Date;
    /** Only trips with at least one open seat (booked < capacity). */
    hasSpace?: boolean;
    /** "fun_dive" for no linked course, "course" for a course session. */
    tripType?: "fun_dive" | "course";
  } = {},
): Promise<{ trips: TripWithBookedCount[]; nextCursor: string | null }> {
  const now = options.now ?? nowDate();
  const limit = options.limit ?? SCHEDULE_PAGE_SIZE;
  const after = decodeCursor(options.cursor);
  const afterDate = after ? new Date(after[0]) : null;
  const lowerBound = options.monthStart && options.monthStart > now ? options.monthStart : now;

  const rows = await db
    .select({
      trip: trips,
      course: courses,
      diveSite: diveSites,
      booked: count(bookings.id),
    })
    .from(trips)
    .leftJoin(courses, eq(courses.id, trips.courseId))
    .leftJoin(diveSites, eq(diveSites.id, trips.diveSiteId))
    .leftJoin(bookings, and(eq(bookings.tripId, trips.id), ne(bookings.status, "cancelled")))
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        gte(trips.startsAt, lowerBound),
        options.monthEnd ? lt(trips.startsAt, options.monthEnd) : undefined,
        options.tripType === "fun_dive" ? isNull(trips.courseId) : undefined,
        options.tripType === "course" ? isNotNull(trips.courseId) : undefined,
        afterDate && after && !Number.isNaN(afterDate.getTime())
          ? or(
              gt(trips.startsAt, afterDate),
              and(eq(trips.startsAt, afterDate), gt(trips.id, after[1])),
            )
          : undefined,
      ),
    )
    .groupBy(trips.id, courses.id, diveSites.id)
    .having(options.hasSpace ? sql`count(${bookings.id}) < ${trips.capacity}` : undefined)
    .orderBy(asc(trips.startsAt), asc(trips.id))
    .limit(limit + 1);

  const page = rows
    .slice(0, limit)
    .map(({ trip, course, diveSite, booked }) => ({ ...trip, course, diveSite, booked }));
  const last = page.at(-1);
  return {
    trips: page,
    nextCursor:
      rows.length > limit && last ? encodeCursor(last.startsAt.toISOString(), last.id) : null,
  };
}

/**
 * How many meeting windows each of these trips has, in one query.
 *
 * The schedule builder needs it to warn before sliding a three-day course as a
 * block; asking per row would be one round trip per departure on the board.
 * Trips with no rows at all are simply absent from the map — callers read that
 * as the single implicit day every trip is created with.
 */
export async function tripScheduleDayCounts(
  db: DbExecutor,
  tripIds: string[],
): Promise<Map<string, number>> {
  if (tripIds.length === 0) return new Map();
  const rows = await db
    .select({ tripId: tripScheduleDays.tripId, days: count() })
    .from(tripScheduleDays)
    .where(inArray(tripScheduleDays.tripId, tripIds))
    .groupBy(tripScheduleDays.tripId);
  return new Map(rows.map((row) => [row.tripId, row.days]));
}

/**
 * Board-wide aggregates for the staff stat tiles, computed in the database so
 * they stay exact when the list itself is paged.
 */
export async function upcomingScheduleStats(
  db: AppDb,
  shopId: string,
  now: Date = nowDate(),
): Promise<{ departures: number; booked: number; openSeats: number; atCapacity: number }> {
  const perTrip = db
    .select({
      tripId: trips.id,
      capacity: trips.capacity,
      booked: count(bookings.id).as("booked"),
    })
    .from(trips)
    .leftJoin(bookings, and(eq(bookings.tripId, trips.id), ne(bookings.status, "cancelled")))
    .where(and(eq(trips.shopId, shopId), eq(trips.status, "scheduled"), gte(trips.startsAt, now)))
    .groupBy(trips.id)
    .as("per_trip");

  const [row] = await db
    .select({
      departures: count(),
      booked: sql<number>`coalesce(sum(${perTrip.booked}), 0)::int`,
      capacity: sql<number>`coalesce(sum(${perTrip.capacity}), 0)::int`,
      atCapacity: sql<number>`count(*) filter (where ${perTrip.booked} >= ${perTrip.capacity})::int`,
    })
    .from(perTrip);

  const departures = row?.departures ?? 0;
  const booked = row?.booked ?? 0;
  return {
    departures,
    booked,
    openSeats: Math.max(0, (row?.capacity ?? 0) - booked),
    atCapacity: row?.atCapacity ?? 0,
  };
}

/**
 * First and last upcoming departure, to pick the calendar's default month and
 * bound its pager without loading a single trip row.
 */
export async function upcomingScheduleRange(
  db: AppDb,
  shopId: string,
  now: Date = nowDate(),
): Promise<{ first: Date | null; last: Date | null }> {
  const [range] = await db
    .select({
      first: sql<string | null>`min(${trips.startsAt})`,
      last: sql<string | null>`max(${trips.startsAt})`,
    })
    .from(trips)
    .where(and(eq(trips.shopId, shopId), eq(trips.status, "scheduled"), gte(trips.startsAt, now)));
  return {
    first: range?.first ? new Date(range.first) : null,
    last: range?.last ? new Date(range.last) : null,
  };
}

/**
 * The diver calendar's month of trips, bounded to the shop-local month so the
 * grid stays complete no matter how the list below it is paged.
 */
export async function upcomingTripsForCalendar(
  db: AppDb,
  shopId: string,
  monthStartUtc: Date,
  monthEndUtc: Date,
  now: Date = nowDate(),
): Promise<{ id: string; title: string; startsAt: Date; capacity: number; booked: number }[]> {
  const from = monthStartUtc > now ? monthStartUtc : now;
  return db
    .select({
      id: trips.id,
      title: trips.title,
      startsAt: trips.startsAt,
      capacity: trips.capacity,
      booked: count(bookings.id),
    })
    .from(trips)
    .leftJoin(bookings, and(eq(bookings.tripId, trips.id), ne(bookings.status, "cancelled")))
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        gte(trips.startsAt, from),
        lt(trips.startsAt, monthEndUtc),
      ),
    )
    .groupBy(trips.id)
    .orderBy(asc(trips.startsAt));
}

export type StaffScheduleDay = {
  dayNumber: number;
  startsAt: Date;
  endsAt: Date;
};

export type StaffScheduleTrip = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  courseTitle: string | null;
  days: StaffScheduleDay[];
  crew: Array<{ id: string; name: string; roles: string[] }>;
};

/**
 * The staff board's bounded month query. A multi-day class is returned once,
 * with each meeting window preserved, and crew is grouped by person so the UI
 * can show both an individual's commitments and an owner's coverage gaps.
 */
export async function upcomingStaffSchedule(
  db: DbExecutor,
  shopId: string,
  monthStartUtc: Date,
  monthEndUtc: Date,
  now: Date = nowDate(),
): Promise<StaffScheduleTrip[]> {
  const rows = await db
    .select({
      trip: trips,
      courseTitle: courses.title,
      day: tripScheduleDays,
      personId: people.id,
      personName: people.fullName,
      role: personRoles.role,
    })
    .from(trips)
    .leftJoin(courses, eq(courses.id, trips.courseId))
    .innerJoin(tripScheduleDays, eq(tripScheduleDays.tripId, trips.id))
    .leftJoin(tripAssignments, eq(tripAssignments.tripId, trips.id))
    .leftJoin(people, eq(people.id, tripAssignments.personId))
    .leftJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        gte(trips.endsAt, now),
        lt(tripScheduleDays.startsAt, monthEndUtc),
        gt(tripScheduleDays.endsAt, monthStartUtc),
      ),
    )
    .orderBy(asc(trips.startsAt), asc(tripScheduleDays.dayNumber), asc(people.fullName));

  const byTrip = new Map<string, StaffScheduleTrip>();
  const daysByTrip = new Map<string, Map<number, StaffScheduleDay>>();
  const crewByTrip = new Map<string, Map<string, { id: string; name: string; roles: string[] }>>();
  for (const row of rows) {
    const existing = byTrip.get(row.trip.id) ?? {
      id: row.trip.id,
      title: row.trip.title,
      startsAt: row.trip.startsAt,
      endsAt: row.trip.endsAt,
      courseTitle: row.courseTitle,
      days: [],
      crew: [],
    };
    byTrip.set(row.trip.id, existing);

    const days = daysByTrip.get(row.trip.id) ?? new Map<number, StaffScheduleDay>();
    days.set(row.day.dayNumber, {
      dayNumber: row.day.dayNumber,
      startsAt: row.day.startsAt,
      endsAt: row.day.endsAt,
    });
    daysByTrip.set(row.trip.id, days);

    if (row.personId && row.personName) {
      const crew =
        crewByTrip.get(row.trip.id) ??
        new Map<string, { id: string; name: string; roles: string[] }>();
      const member = crew.get(row.personId) ?? {
        id: row.personId,
        name: row.personName,
        roles: [],
      };
      if (row.role && !member.roles.includes(row.role)) member.roles.push(row.role);
      crew.set(row.personId, member);
      crewByTrip.set(row.trip.id, crew);
    }
  }

  return [...byTrip.values()].map((trip) => ({
    ...trip,
    days: [...(daysByTrip.get(trip.id)?.values() ?? [])].sort((a, b) => a.dayNumber - b.dayNumber),
    crew: [...(crewByTrip.get(trip.id)?.values() ?? [])].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
  }));
}

/**
 * The sessions a public course page offers to book. Seats left comes from the
 * same booked-count shape the schedule uses, so a full session reads as full
 * here too rather than sending a diver to a dead end.
 */
export async function listUpcomingSessionsForCourse(
  db: AppDb,
  shopId: string,
  courseId: string,
  now: Date = nowDate(),
) {
  const rows = await db
    .select({ trip: trips, booked: count(bookings.id) })
    .from(trips)
    .leftJoin(bookings, and(eq(bookings.tripId, trips.id), ne(bookings.status, "cancelled")))
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.courseId, courseId),
        eq(trips.status, "scheduled"),
        gte(trips.startsAt, now),
      ),
    )
    .groupBy(trips.id)
    .orderBy(asc(trips.startsAt));
  return rows.map(({ trip, booked }) => ({ ...trip, booked }));
}
