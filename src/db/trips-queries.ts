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
import { alias } from "drizzle-orm/pg-core";
import { nowDate } from "@/lib/clock";
import {
  summarizeTripDiveSites,
  type TripDiveSiteRef,
  type TripDiveSiteSummary,
} from "@/lib/trip-dives";
import type { AppDb, DbExecutor } from "./client";
import { decodeCursor, encodeCursor } from "./cursor";
import { offsetPage } from "./paging";
import {
  bookings,
  courses,
  diveSites,
  people,
  personRoles,
  tripAssignments,
  tripDives,
  tripScheduleDays,
  trips,
} from "./schema";
import { liveTrip } from "./trips-live";

/**
 * Reading the board: the schedule lists, their aggregates, and the calendar
 * feeds — everything that answers "what is coming up" rather than "what is this
 * one departure".
 *
 * The paged reads are the ones to reach for. `upcomingTripsWithCounts` loads
 * every future trip and survives ONLY as a test fixture — no production code
 * calls it, and none should ever again, because a busy shop's board grows
 * without bound (`pagedUpcomingTripsWithCounts` keysets it instead).
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
  const [row] = await db
    .select({ total: count() })
    .from(trips)
    .where(and(eq(trips.shopId, shopId), liveTrip()));
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
 *
 * **Test fixture only.** This is an unbounded whole-schedule read — every
 * future trip in one query — and it has no production callers left. It stays
 * because dozens of test files use it to find a seeded trip by title; it must
 * never be reached for in product code, where a busy shop's board grows
 * without bound. Product surfaces page instead: `pagedUpcomingTripsWithCounts`
 * (keyset) or a window-bounded read like
 * `listTripIdsInOfflineManifestWindow`.
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
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        gte(trips.startsAt, new Date(now.getTime() - 60 * 60 * 1000)),
      ),
    )
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
        liveTrip(),
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        gte(trips.endsAt, new Date(now.getTime() - 60 * 60 * 1000)),
        lte(trips.startsAt, until),
      ),
    )
    .orderBy(asc(trips.startsAt));
  return rows.map((row) => row.id);
}

/**
 * One keyset page of the schedule, on the diver agenda and the staff board
 * alike. Two weeks of a busy shop's diving, roughly — small enough that both
 * pages read in a couple of screens and the "Show later departures" pager
 * does its job, instead of a 20-row window tall enough that the pager was
 * nearly decorative (the pages screenshotted at ~5,000px).
 *
 * **Deliberately not a `PAGE_SIZE` tier** (`./paging.ts`, issue 763). Those
 * count *records* in an offset list that can say "page 4 of 7"; this counts
 * **days** in a keyset stream with no end to number, which is the one earned
 * exception ADR 20260803-one-pagination-model already carves out. Fourteen is
 * two weeks, not twenty of anything.
 */
export const SCHEDULE_PAGE_SIZE = 14;

/**
 * What "an upcoming departure a page may show" means, in one place.
 *
 * Both the keyset reader below and the offset reader after it build their
 * `where` from this, so a filter can never mean one thing to the schedule
 * board and another to the booking picker — and, in the offset case, one thing
 * to the rows and another to the count that pages them.
 */
function upcomingTripScope(
  shopId: string,
  bounds: {
    from: Date;
    monthEnd?: Date;
    tripType?: "fun_dive" | "course";
    publicOnly?: boolean;
  },
) {
  return and(
    eq(trips.shopId, shopId),
    eq(trips.status, "scheduled"),
    bounds.publicOnly ? eq(trips.isPrivate, false) : undefined,
    gte(trips.startsAt, bounds.from),
    bounds.monthEnd ? lt(trips.startsAt, bounds.monthEnd) : undefined,
    bounds.tripType === "fun_dive" ? isNull(trips.courseId) : undefined,
    bounds.tripType === "course" ? isNotNull(trips.courseId) : undefined,
  );
}

/**
 * "At least one seat left", as a `having` over the same booking join the row
 * query counts with. `trips.capacity` is legal here despite grouping only by
 * `trips.id`: the id is the primary key, so Postgres treats every other column
 * of the row as functionally dependent on it.
 */
function hasSpaceHaving(hasSpace: boolean | undefined) {
  return hasSpace ? sql`count(${bookings.id}) < ${trips.capacity}` : undefined;
}

/** The join that makes `booked` a count of live bookings rather than all of them. */
const liveBookingJoin = and(eq(bookings.tripId, trips.id), ne(bookings.status, "cancelled"));

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
    /** Hide private charters/sessions (e.g. for public storefront schedule). */
    publicOnly?: boolean;
  } = {},
): Promise<{ trips: TripWithBookedCount[]; nextCursor: string | null }> {
  const now = options.now ?? nowDate();
  const limit = options.limit ?? SCHEDULE_PAGE_SIZE;
  const after = decodeCursor(options.cursor);
  const afterDate = after ? new Date(after[0]) : null;
  const nowWithBuffer = new Date(now.getTime() - 60 * 60 * 1000);
  const lowerBound =
    options.monthStart && options.monthStart > nowWithBuffer ? options.monthStart : nowWithBuffer;

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
    .leftJoin(bookings, liveBookingJoin)
    .where(
      and(
        liveTrip(),
        upcomingTripScope(shopId, {
          from: lowerBound,
          monthEnd: options.monthEnd,
          tripType: options.tripType,
          publicOnly: options.publicOnly,
        }),
        afterDate && after && !Number.isNaN(afterDate.getTime())
          ? or(
              gt(trips.startsAt, afterDate),
              and(eq(trips.startsAt, afterDate), gt(trips.id, after[1])),
            )
          : undefined,
      ),
    )
    .groupBy(trips.id, courses.id, diveSites.id)
    .having(hasSpaceHaving(options.hasSpace))
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

export type UpcomingTripOffsetPage = {
  trips: TripWithBookedCount[];
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
};

/**
 * The same upcoming-departure list as {@link pagedUpcomingTripsWithCounts},
 * offset-paged — for a surface that is *picking one departure* rather than
 * walking the season forward.
 *
 * The schedule board keeps its cursor stack on purpose: it reads a stream with
 * no end to count, and "Show earlier"/"Show later" name a direction in time
 * (ADR 20260803-one-pagination-model). The add-booking picker is the opposite
 * shape. It has a filter (`hasSpace`) and a question with an answer — "which
 * Saturday?" — and it used to show the first 24 and then say *go look at the
 * board*, the last surface where staff met that instead of "page 2 of 4".
 *
 * The count runs over the grouped, `having`-filtered set as a subquery rather
 * than over `trips` directly. Counting the base table would ignore `hasSpace`
 * and promise pages made entirely of sold-out departures the rows below can
 * never contain.
 */
export async function offsetUpcomingTripsWithCounts(
  db: AppDb,
  shopId: string,
  options: {
    page?: number;
    limit?: number;
    now?: Date;
    monthEnd?: Date;
    /** Only trips with at least one open seat (booked < capacity). */
    hasSpace?: boolean;
    /** "fun_dive" for no linked course, "course" for a course session. */
    tripType?: "fun_dive" | "course";
  } = {},
): Promise<UpcomingTripOffsetPage> {
  const now = options.now ?? nowDate();
  const scope = upcomingTripScope(shopId, {
    from: now,
    monthEnd: options.monthEnd,
    tripType: options.tripType,
  });
  const having = hasSpaceHaving(options.hasSpace);

  const paged = await offsetPage({
    page: options.page,
    pageSize: options.limit ?? SCHEDULE_PAGE_SIZE,
    countRows: async () => {
      const matching = db
        .select({ id: trips.id })
        .from(trips)
        .leftJoin(bookings, liveBookingJoin)
        .where(and(scope, liveTrip()))
        .groupBy(trips.id)
        .having(having)
        .as("matching_trips");
      const [counted] = await db.select({ total: count() }).from(matching);
      return counted?.total ?? 0;
    },
    fetchRows: async (offset, limit) =>
      db
        .select({
          trip: trips,
          course: courses,
          diveSite: diveSites,
          booked: count(bookings.id),
        })
        .from(trips)
        .leftJoin(courses, eq(courses.id, trips.courseId))
        .leftJoin(diveSites, eq(diveSites.id, trips.diveSiteId))
        .leftJoin(bookings, liveBookingJoin)
        .where(and(scope, liveTrip()))
        .groupBy(trips.id, courses.id, diveSites.id)
        .having(having)
        .orderBy(asc(trips.startsAt), asc(trips.id))
        .limit(limit)
        .offset(offset),
  });

  return {
    trips: paged.rows.map(({ trip, course, diveSite, booked }) => ({
      ...trip,
      course,
      diveSite,
      booked,
    })),
    page: paged.page,
    pageCount: paged.pageCount,
    pageSize: paged.pageSize,
    total: paged.total,
  };
}

/**
 * Where each of these departures actually goes, in one query.
 *
 * The list readers above join `dive_sites` on `trips.dive_site_id`, which is
 * only dive one's site copied onto the trip row — enough for the forecast point
 * and the calendar feed's location, never enough to *tell a diver where the
 * boat goes*. A two-site day named one site; a day whose undecided tank was the
 * first one named none. This reads the dives themselves, so a card can say both
 * how many sites the trip visits and how many tanks are still open.
 *
 * Shop ownership is proven on the query — through the trip and again on each
 * site — rather than assumed from the trip's pointer (the CR-007 house rule).
 *
 * A departure with **no dive rows at all** falls back to its own
 * `dive_site_id`, which is the only thing it can say. Every write path mints
 * one dive row per planned dive (`insertTripInstance`, `replaceTripDives`), so
 * that shape should not exist — but a reader that answers "nowhere" for a trip
 * whose row plainly names a site would be a worse bug than the one it is
 * fixing, and the demo seed builds trips exactly that way today.
 */
export async function tripDiveSiteSummaries(
  db: DbExecutor,
  shopId: string,
  tripIds: string[],
): Promise<Map<string, TripDiveSiteSummary>> {
  if (tripIds.length === 0) return new Map();
  // Two reaches into the same table — the site on each dive, and the trip's own
  // fallback pointer — so they need distinct aliases.
  const diveSite = alias(diveSites, "trip_dive_site");
  const tripSite = alias(diveSites, "trip_primary_site");
  const rows = await db
    .select({
      tripId: trips.id,
      diveNumber: tripDives.diveNumber,
      siteId: diveSite.id,
      siteName: diveSite.name,
      tripSiteId: tripSite.id,
      tripSiteName: tripSite.name,
    })
    .from(trips)
    .leftJoin(tripDives, eq(tripDives.tripId, trips.id))
    .leftJoin(diveSite, and(eq(diveSite.id, tripDives.diveSiteId), eq(diveSite.shopId, shopId)))
    .leftJoin(tripSite, and(eq(tripSite.id, trips.diveSiteId), eq(tripSite.shopId, shopId)))
    .where(and(inArray(trips.id, tripIds), eq(trips.shopId, shopId), liveTrip()))
    .orderBy(asc(trips.id), asc(tripDives.diveNumber));

  const byTrip = new Map<string, TripDiveSiteRef[]>();
  const fallbackByTrip = new Map<string, { id: string; name: string } | null>();
  for (const row of rows) {
    fallbackByTrip.set(
      row.tripId,
      row.tripSiteId && row.tripSiteName ? { id: row.tripSiteId, name: row.tripSiteName } : null,
    );
    const dives = byTrip.get(row.tripId) ?? [];
    // `diveNumber` is null only when the left join found no dive row at all.
    if (row.diveNumber !== null) {
      dives.push({
        diveNumber: row.diveNumber,
        site: row.siteId && row.siteName ? { id: row.siteId, name: row.siteName } : null,
      });
    }
    byTrip.set(row.tripId, dives);
  }

  const summaries = new Map<string, TripDiveSiteSummary>();
  for (const [tripId, dives] of byTrip) {
    if (dives.length > 0) {
      summaries.set(tripId, summarizeTripDiveSites(dives));
      continue;
    }
    const fallback = fallbackByTrip.get(tripId) ?? null;
    // No dives *and* no pointer says nothing — never "0 sites, 0 open tanks",
    // which a surface would read as a real, empty answer.
    if (fallback) summaries.set(tripId, { sites: [fallback], undecidedDives: 0 });
  }
  return summaries;
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
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        gte(trips.startsAt, new Date(now.getTime() - 60 * 60 * 1000)),
      ),
    )
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
  options: { publicOnly?: boolean } = {},
): Promise<{ first: Date | null; last: Date | null }> {
  const [range] = await db
    .select({
      first: sql<string | null>`min(${trips.startsAt})`,
      last: sql<string | null>`max(${trips.startsAt})`,
    })
    .from(trips)
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        options.publicOnly ? eq(trips.isPrivate, false) : undefined,
        gte(trips.startsAt, new Date(now.getTime() - 60 * 60 * 1000)),
      ),
    );
  return {
    first: range?.first ? new Date(range.first) : null,
    last: range?.last ? new Date(range.last) : null,
  };
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
        liveTrip(),
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        gte(trips.endsAt, new Date(now.getTime() - 60 * 60 * 1000)),
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
        liveTrip(),
        eq(trips.shopId, shopId),
        eq(trips.courseId, courseId),
        eq(trips.status, "scheduled"),
        eq(trips.isPrivate, false),
        gte(trips.startsAt, new Date(now.getTime() - 60 * 60 * 1000)),
      ),
    )
    .groupBy(trips.id)
    .orderBy(asc(trips.startsAt));
  return rows.map(({ trip, booked }) => ({ ...trip, booked }));
}
