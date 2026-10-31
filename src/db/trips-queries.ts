import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { sellableSeats } from "@/lib/boat-safety";
import { type CalendarDate, calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { perDiverBookingPriceCents } from "@/lib/courses";
import { SEAT_HELD_STATUSES } from "@/lib/no-show";
import type { SeatCounts } from "@/lib/participant-types";
import {
  summarizeTripDiveSites,
  type TripDiveSiteRef,
  type TripDiveSiteSummary,
} from "@/lib/trip-dives";
import { DEPARTURE_BUFFER_MS } from "@/lib/trips";
import { shiftWeek, weekDates } from "@/lib/week-board";
import { shopDayBounds, shopDaysBounds, wallTimeToUtc } from "@/lib/zoned";
import type { AppDb, DbExecutor } from "./client";
import { decodeCursor, encodeCursor } from "./cursor";
import { offsetPage } from "./paging";
import {
  boats,
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
import { tripPrimarySiteId } from "./trip-primary-site";
import { liveTrip, notRehearsal } from "./trips-live";

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
  /** The boat's raw total-occupant capacity, including assigned crew places. */
  boatCapacity: number | null;
  /** Crew assignments on this trip, each reserving one boat occupant place. */
  assignedCrewCount: number;
  /**
   * The seats this departure may actually sell (H-107, #2321): `capacity`
   * capped at the boat's passenger certificate and total-occupant capacity
   * after assigned crew places (`sellableSeats`). Every seats-left read is
   * measured against this; `capacity` stays the passenger-place count the
   * details form edits.
   */
  sellableCapacity: number;
  /**
   * The divers among `booked` (ADR 20261007-participant-types): what the
   * divemaster ratio supervises. Capacity and headcount stay on `booked`.
   */
  bookedDivers: number;
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

/** A shop-local day of scheduled staff departures, including private/rehearsal trips. */
export async function shopDayTripsWithCounts(
  db: DbExecutor,
  shopId: string,
  date: CalendarDate,
  timeZone: string,
  now: Date = nowDate(),
): Promise<{ id: string; booked: number }[]> {
  const { from, to } = shopDaysBounds(date, date, timeZone);
  const lowerBound = new Date(now.getTime() - DEPARTURE_BUFFER_MS);
  const startsAtFrom = from > lowerBound ? from : lowerBound;

  return db
    .select({ id: trips.id, booked: count(bookings.id) })
    .from(trips)
    .leftJoin(bookings, liveBookingJoin)
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        gte(trips.startsAt, startsAtFrom),
        lt(trips.startsAt, to),
      ),
    )
    .groupBy(trips.id)
    .orderBy(asc(trips.startsAt), asc(trips.title), asc(trips.id));
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
        gte(trips.endsAt, new Date(now.getTime() - DEPARTURE_BUFFER_MS)),
        lte(trips.startsAt, until),
      ),
    )
    .orderBy(asc(trips.startsAt));
  return rows.map((row) => row.id);
}

/** One departure of the shop's own calendar day, as the paper day names it. */
export type ShopDayDeparture = {
  id: string;
  title: string;
  startsAt: Date;
};

/**
 * Every departure inside the shop's **own** calendar day containing `now`,
 * in clock order.
 *
 * The day is bracketed by `shopDayBounds`, so a shop in Key West gets the day
 * a captain there would name, not the UTC one a server happens to be in: at
 * 05:00 in Florida the UTC date has already rolled over, and a naive
 * instant-based window would print tomorrow's board on this morning's paper.
 *
 * Cancelled departures are excluded for the reason `todaysTrips` excludes them
 * in `src/db/closeout.ts` — a boat that will not sail has nothing to hand a
 * captain — and `liveTrip()` keeps a deleted departure off the sheet the same
 * way it keeps it off every other read of `trips`.
 */
export async function listShopDayDepartures(
  db: DbExecutor,
  shopId: string,
  timeZone: string,
  now: Date = nowDate(),
): Promise<ShopDayDeparture[]> {
  const { from, to } = shopDayBounds(now, timeZone);
  return db
    .select({ id: trips.id, title: trips.title, startsAt: trips.startsAt })
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
    .orderBy(asc(trips.startsAt), asc(trips.title), asc(trips.id));
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
    /**
     * One of the shop's own words for a kind of day (ADR
     * 20260904-reef-all-the-way-down, decision 2). Applied **here**, in SQL,
     * rather than over the fetched page: this list is keyset-paged at fourteen
     * rows, so an in-memory narrowing yields short and empty pages and a
     * "Show later" that promises rows it cannot deliver.
     */
    lensId?: string;
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
    bounds.lensId ? eq(trips.lensId, bounds.lensId) : undefined,
  );
}

/**
 * "At least one seat left", as a `having` over the same booking join the row
 * query counts with. `trips.capacity` is legal here despite grouping only by
 * `trips.id`: the id is the primary key, so Postgres treats every other column
 * of the row as functionally dependent on it.
 */
function hasSpaceHaving(hasSpace: boolean | undefined) {
  return hasSpace ? sql`count(${bookings.id}) < ${tripSellableSeatsSql()}` : undefined;
}

/**
 * The departure's boat's certificate passenger limit, as a scalar subquery on
 * the trip row: null with no boat or no certificate recorded. Scoped to the
 * trip's own shop, and a deleted boat's certificate still binds — the same
 * answer `boatCertifiedPassengers` gives one trip at a time. A subquery rather
 * than a join, so no grouped read has to add the boat to its `group by`.
 */
export const tripBoatCertifiedPassengers = () =>
  sql<
    number | null
  >`(select ${boats.certifiedPassengers} from ${boats} where ${boats.id} = ${trips.boatId} and ${boats.shopId} = ${trips.shopId})`;

/** The same subquery for total persons, crew included (#2302): never a seat ceiling. */
export const tripBoatCertifiedTotalPersons = () =>
  sql<
    number | null
  >`(select ${boats.certifiedTotalPersons} from ${boats} where ${boats.id} = ${trips.boatId} and ${boats.shopId} = ${trips.shopId})`;

/** Raw total occupants allowed aboard the assigned hull, or null without one. */
export const tripBoatCapacity = () =>
  sql<
    number | null
  >`(select ${boats.capacity} from ${boats} where ${boats.id} = ${trips.boatId} and ${boats.shopId} = ${trips.shopId})`;

/** Every assigned crew member reserves one occupant place, whether boarded yet or not. */
export const tripAssignedCrewCount = () =>
  sql<number>`(select count(*)::int from ${tripAssignments} where ${tripAssignments.tripId} = ${trips.id})`.mapWith(
    Number,
  );

/**
 * `sellableSeats` spelled in SQL, for the one place the number has to be
 * compared inside the query: `hasSpace`'s `having`, which a page of results
 * cannot filter after the fact. Every row read returns the number through
 * `sellableSeats` itself; `certificate-ceiling.test.ts` pins the two together.
 */
export function tripSellableSeatsSql() {
  return sql<number>`greatest(0, least(
    ${trips.capacity},
    coalesce(${tripBoatCertifiedPassengers()}, ${trips.capacity}),
    coalesce(${tripBoatCapacity()} - ${tripAssignedCrewCount()}, ${trips.capacity})
  ))`.mapWith(Number);
}

/** A counted trip row with its seats on sale beside its stated capacity. */
function withSellableCapacity<T extends { capacity: number }>(
  trip: T,
  certifiedPassengers: number | null,
  boatCapacity: number | null,
  assignedCrewCount: number,
): T & { boatCapacity: number | null; assignedCrewCount: number; sellableCapacity: number } {
  return {
    ...trip,
    boatCapacity,
    assignedCrewCount,
    sellableCapacity: sellableSeats(
      trip.capacity,
      certifiedPassengers,
      boatCapacity,
      assignedCrewCount,
    ),
  };
}

/**
 * **A booking that still holds a seat**, as a SQL predicate.
 *
 * The statuses themselves are `SEAT_HELD_STATUSES` in `src/lib/no-show.ts`,
 * where the boundary is argued and why it moved is written down; this is the
 * one place they are spelled as a `where` clause, so no capacity count has to
 * write `ne(bookings.status, "cancelled")` again.
 *
 * **Only the seat *counts* take it** — the booking transaction, the restore,
 * the walk-in picker, the departure's own record and its capacity floor, the
 * wait-list join, the public dive-site page's departures, and the
 * schedule/board join below. The roster, the manifest, the gear register and
 * the buddy builder still reach for every booking that is not cancelled, and
 * must: a diver marked absent stays on the manifest, which is what the crew
 * needs to see.
 *
 * **The counts that deliberately stay looser**, each counting a released seat
 * as still held. None can oversell — every one of them counts *more* seats
 * than `createBookingRecord` will — and each is conservative in the direction
 * its own question needs (reviewed 2026-09-11, after the public dive-site page
 * was found telling a stranger a released seat's boat was full):
 *
 * - `getStaffingView` (`./staffing.ts`) and `tripRatioGapNeedsInstructor`
 *   (`./crew-requests.ts`) size crew against the count. A diver the desk wrote
 *   off can still be boarded at the rail (`reclaimReleasedSeat`,
 *   `./manifests.ts`), so the ratio has to already cover them; under-crewing a
 *   course is the one error here that reaches the water.
 * - `listDeparturesAwaitingMinimumDecision` and `listMinimumNotMetRecipients`
 *   (`./trips-minimum.ts`) decide whether a boat runs and who hears that it did
 *   not. Cancelling a departure is not reversible for the divers on it, so the
 *   sweep counts the fuller number and tells everyone who ever held a seat.
 * - `blowoutCandidates` (`./blowouts.ts`) gates which boats a weather cascade
 *   may offer. Withholding a seat that turns out to exist costs a rescue
 *   offer; offering one that does not exist costs the diver a second refusal
 *   on the day their trip was already cancelled.
 */
export const seatHeld = inArray(bookings.status, [...SEAT_HELD_STATUSES]);

/**
 * The join that makes `booked` a count of the seats somebody is holding rather
 * than of every row. Exported so every reader counts seats with the same
 * predicate the schedule does, rather than a second spelling of it.
 */
export const liveBookingJoin = and(eq(bookings.tripId, trips.id), seatHeld);

/**
 * The divers among the seats a `liveBookingJoin` counts. `count(bookings.id)`
 * rather than `count(*)`, so a departure with no seats counts zero through the
 * left join. A function so each select gets its own expression.
 */
export const bookedDiversCount = () =>
  sql<number>`count(${bookings.id}) filter (where ${bookings.participantType} = 'diver')`.mapWith(
    Number,
  );

/** The snorkelers among the held seats, the same count shape as `bookedDiversCount`. */
export const bookedSnorkelersCount = () =>
  sql<number>`count(${bookings.id}) filter (where ${bookings.participantType} = 'snorkeler')`.mapWith(
    Number,
  );

/**
 * **Every seat held on a departure, and the divers among them** — the two
 * numbers the two limits are measured against (ADR 20261007-participant-types).
 *
 * `seatHeld`, the same predicate the schedule counts with, so a seat released
 * at the counter is free under both limits at once. One query, one snapshot:
 * reading the two counts separately would let a concurrent write land between
 * them on a reader that is not holding the trip-row lock. Every seat-granting
 * caller holds it (`createBookingRecord`, `restoreBooking`,
 * `setBookingParticipantType`, `undoBookingNoShow`, `setTripParticipantTerms`),
 * which is what makes the answer a gate rather than advice. The ones that add
 * someone aboard (`createBookingRecord`, `restoreBooking`, `undoBookingNoShow`,
 * `askForDeparture`) measure the boat against `sellableCapacity`.
 */
export async function heldSeatCounts(
  tx: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<SeatCounts> {
  const [row] = await tx
    .select({
      aboard: count(bookings.id),
      divers: sql<number>`count(*) filter (where ${bookings.participantType} = 'diver')`.mapWith(
        Number,
      ),
    })
    .from(bookings)
    .where(and(eq(bookings.shopId, shopId), eq(bookings.tripId, tripId), seatHeld));
  return { aboard: row?.aboard ?? 0, divers: row?.divers ?? 0 };
}

/**
 * **The passenger capacity a seat-granting gate measures against** (H-107):
 * the departure's passenger places, capped at the boat's passenger certificate
 * and total-occupant capacity after assigning one place per crew member
 * (`sellableSeats`). A grant calls this inside the transaction holding the
 * trip-row lock, beside `heldSeatCounts`, and hands it to `seatRefusal` in
 * place of `trip.capacity`. Crew writers take that same trip lock, and the
 * boat read is shared-locked after it, so either writer sees the other commit.
 * A deleted boat still binds: the hull is the same hull.
 */
export async function sellableCapacity(
  tx: DbExecutor,
  trip: {
    shopId: string;
    boatId: string | null;
    capacity: number;
    id?: string;
    tripId?: string;
  },
): Promise<number> {
  const tripId = trip.id ?? trip.tripId;
  if (!tripId) throw new Error("sellableCapacity requires the trip id to count assigned crew");
  const [boat] = trip.boatId
    ? await tx
        .select({ capacity: boats.capacity, certifiedPassengers: boats.certifiedPassengers })
        .from(boats)
        .where(and(eq(boats.id, trip.boatId), eq(boats.shopId, trip.shopId)))
        // Seat grants already hold the trip row. Boat-capacity edits lock
        // affected trips before the boat row, so this shared read keeps the
        // same trip -> boat lock order.
        .for("share", { of: boats })
        .limit(1)
    : [];
  const [crew] = await tx
    .select({ total: count() })
    .from(tripAssignments)
    .where(eq(tripAssignments.tripId, tripId));
  return sellableSeats(
    trip.capacity,
    boat?.certifiedPassengers ?? null,
    boat?.capacity ?? null,
    crew?.total ?? 0,
  );
}

/** The boat's certificate passenger limit, or null when there is no boat or none recorded. */
export async function boatCertifiedPassengers(
  tx: DbExecutor,
  shopId: string,
  boatId: string | null,
): Promise<number | null> {
  if (!boatId) return null;
  const [boat] = await tx
    .select({ certifiedPassengers: boats.certifiedPassengers })
    .from(boats)
    .where(and(eq(boats.id, boatId), eq(boats.shopId, shopId)))
    .limit(1);
  return boat?.certifiedPassengers ?? null;
}

/**
 * The schedule page's list, one keyset page at a time (ordered by departure,
 * then title, then id for a stable tiebreak). `upcomingTripsWithCounts` stays for callers
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
    /**
     * The page *before* this cursor instead of the one after it: the same
     * (start, title, id) key read in reverse, so Back needs no history in the
     * URL. Wins over `cursor` when both are given.
     */
    before?: string;
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
    /** Only departures wearing this one of the shop's own words for a kind of day. */
    lensId?: string;
  } = {},
): Promise<{
  trips: TripWithBookedCount[];
  nextCursor: string | null;
  /** The cursor that opens the page before this one; null on the first page. */
  prevCursor: string | null;
}> {
  const now = options.now ?? nowDate();
  const limit = options.limit ?? SCHEDULE_PAGE_SIZE;
  const before = decodeCursor(options.before);
  const after = before ? null : decodeCursor(options.cursor);
  const afterDate = after ? new Date(after[0]) : null;
  const beforeDate = before ? new Date(before[0]) : null;
  const nowWithBuffer = new Date(now.getTime() - DEPARTURE_BUFFER_MS);
  const lowerBound =
    options.monthStart && options.monthStart > nowWithBuffer ? options.monthStart : nowWithBuffer;

  const rows = await db
    .select({
      trip: trips,
      course: courses,
      diveSite: diveSites,
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
        upcomingTripScope(shopId, {
          from: lowerBound,
          monthEnd: options.monthEnd,
          tripType: options.tripType,
          publicOnly: options.publicOnly,
          lensId: options.lensId,
        }),
        afterDate && after && !Number.isNaN(afterDate.getTime())
          ? or(
              gt(trips.startsAt, afterDate),
              and(eq(trips.startsAt, afterDate), gt(trips.title, after[1])),
              and(eq(trips.startsAt, afterDate), eq(trips.title, after[1]), gt(trips.id, after[2])),
            )
          : undefined,
        beforeDate && before && !Number.isNaN(beforeDate.getTime())
          ? or(
              lt(trips.startsAt, beforeDate),
              and(eq(trips.startsAt, beforeDate), lt(trips.title, before[1])),
              and(
                eq(trips.startsAt, beforeDate),
                eq(trips.title, before[1]),
                lt(trips.id, before[2]),
              ),
            )
          : undefined,
      ),
    )
    .groupBy(trips.id, courses.id, diveSites.id)
    .having(hasSpaceHaving(options.hasSpace))
    // The keyset cursor carries all three keys (`src/db/cursor.ts`, issue
    // #2175), so the filter above resumes exactly after (or, reading back,
    // exactly before) the row the cursor names.
    .orderBy(
      ...(before
        ? [desc(trips.startsAt), desc(trips.title), desc(trips.id)]
        : [asc(trips.startsAt), asc(trips.title), asc(trips.id)]),
    )
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const kept = rows.slice(0, limit);
  // A backward read arrives newest-first; the page always reads oldest-first.
  const ordered = before ? kept.reverse() : kept;
  const page = ordered.map(
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
  const first = page.at(0);
  const last = page.at(-1);
  const cursorOf = (trip: { startsAt: Date; title: string; id: string }) =>
    encodeCursor(trip.startsAt.toISOString(), trip.title, trip.id);
  return {
    trips: page,
    // Paging back stopped at a known row, so there is always a page after this one.
    nextCursor: last && (before || hasMore) ? cursorOf(last) : null,
    // Reading back: an extra row means there are earlier pages. Reading
    // forward from a cursor: the row before this page's first is what the
    // cursor left behind. The very first page has neither.
    prevCursor: first && (before ? hasMore : after) ? cursorOf(first) : null,
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
    /** Exclude departures where this diver already has a booking that cannot be reactivated. */
    excludeBookedForPersonId?: string;
    /** Keep the schedule reader's one-hour late-departure grace. */
    includeDepartureBuffer?: boolean;
    /** "fun_dive" for no linked course, "course" for a course session. */
    tripType?: "fun_dive" | "course";
    /**
     * Only what a diver could be told about: no private charter and no
     * rehearsal (ADR 20261012-rehearsal-departures). For a read that leaves
     * the shop, such as the facts a reply draft quotes.
     */
    outward?: boolean;
  } = {},
): Promise<UpcomingTripOffsetPage> {
  const now = options.now ?? nowDate();
  const existingBooking = alias(bookings, "picker_existing_booking");
  const scope = and(
    upcomingTripScope(shopId, {
      from: options.includeDepartureBuffer ? new Date(now.getTime() - DEPARTURE_BUFFER_MS) : now,
      monthEnd: options.monthEnd,
      tripType: options.tripType,
      publicOnly: options.outward,
    }),
    options.outward ? notRehearsal() : undefined,
    // Applied before LIMIT, to both rows and count. A cancelled booking and a
    // future no-show can be reactivated (`rowCanBeReactivated`, issue #2484);
    // the booking transaction still rechecks that lifecycle and every gate.
    options.excludeBookedForPersonId
      ? notExists(
          db
            .select({ id: existingBooking.id })
            .from(existingBooking)
            .where(
              and(
                eq(existingBooking.shopId, shopId),
                eq(existingBooking.tripId, trips.id),
                eq(existingBooking.personId, options.excludeBookedForPersonId),
                ne(existingBooking.status, "cancelled"),
                or(ne(existingBooking.status, "no_show"), lte(trips.startsAt, nowDate())),
              ),
            ),
        )
      : undefined,
  );
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
          bookedDivers: bookedDiversCount(),
          certifiedPassengers: tripBoatCertifiedPassengers(),
          boatCapacity: tripBoatCapacity(),
          assignedCrewCount: tripAssignedCrewCount(),
        })
        .from(trips)
        .leftJoin(courses, eq(courses.id, trips.courseId))
        .leftJoin(diveSites, eq(diveSites.id, tripPrimarySiteId))
        .leftJoin(bookings, liveBookingJoin)
        .where(and(scope, liveTrip()))
        .groupBy(trips.id, courses.id, diveSites.id)
        .having(having)
        .orderBy(asc(trips.startsAt), asc(trips.title), asc(trips.id))
        .limit(limit)
        .offset(offset),
  });

  return {
    trips: paged.rows.map(
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
    ),
    page: paged.page,
    pageCount: paged.pageCount,
    pageSize: paged.pageSize,
    total: paged.total,
  };
}

/**
 * Where each of these departures actually goes, in one query.
 *
 * The list readers above join `dive_sites` on `tripPrimarySiteId`, the first
 * dive's chosen site: enough for the forecast point and the calendar feed's
 * location, never enough to *tell a diver where the boat goes*. A two-site day
 * named one site. This reads the dives themselves, so a card can say both how
 * many sites the trip visits and how many tanks are still open.
 *
 * Shop ownership is proven on the query, through the trip and again on each
 * site (the CR-007 house rule). A departure with no dive rows is absent from
 * the map; every write path mints one row per planned dive.
 */
export async function tripDiveSiteSummaries(
  db: DbExecutor,
  shopId: string,
  tripIds: string[],
): Promise<Map<string, TripDiveSiteSummary>> {
  if (tripIds.length === 0) return new Map();
  const rows = await db
    .select({
      tripId: trips.id,
      diveNumber: tripDives.diveNumber,
      siteId: diveSites.id,
      siteName: diveSites.name,
    })
    .from(trips)
    .leftJoin(tripDives, eq(tripDives.tripId, trips.id))
    .leftJoin(diveSites, and(eq(diveSites.id, tripDives.diveSiteId), eq(diveSites.shopId, shopId)))
    .where(and(inArray(trips.id, tripIds), eq(trips.shopId, shopId), liveTrip()))
    .orderBy(asc(trips.id), asc(tripDives.diveNumber));

  const byTrip = new Map<string, TripDiveSiteRef[]>();
  for (const row of rows) {
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
    // A trip with no dive rows says nothing — never "0 sites, 0 open tanks",
    // which a surface would read as a real, empty answer.
    if (dives.length > 0) summaries.set(tripId, summarizeTripDiveSites(dives));
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
      capacity: tripSellableSeatsSql().as("capacity"),
      booked: count(bookings.id).as("booked"),
    })
    .from(trips)
    .leftJoin(bookings, liveBookingJoin)
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        gte(trips.startsAt, new Date(now.getTime() - DEPARTURE_BUFFER_MS)),
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
  db: DbExecutor,
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
        gte(trips.startsAt, new Date(now.getTime() - DEPARTURE_BUFFER_MS)),
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
        gte(trips.endsAt, new Date(now.getTime() - DEPARTURE_BUFFER_MS)),
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
    .select({
      trip: trips,
      // The session's site, named on its row as plain text (visual review
      // 2026-10-24, B42); a deleted site names nothing.
      siteName: diveSites.name,
      booked: count(bookings.id),
      certifiedPassengers: tripBoatCertifiedPassengers(),
      boatCapacity: tripBoatCapacity(),
      assignedCrewCount: tripAssignedCrewCount(),
    })
    .from(trips)
    .leftJoin(bookings, liveBookingJoin)
    .leftJoin(
      diveSites,
      and(
        eq(diveSites.id, tripPrimarySiteId),
        eq(diveSites.shopId, trips.shopId),
        isNull(diveSites.deletedAt),
      ),
    )
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, shopId),
        eq(trips.courseId, courseId),
        eq(trips.status, "scheduled"),
        eq(trips.isPrivate, false),
        gte(trips.startsAt, new Date(now.getTime() - DEPARTURE_BUFFER_MS)),
      ),
    )
    .groupBy(trips.id, diveSites.id)
    .orderBy(asc(trips.startsAt));
  // A diver-only read: `capacity` here is the seats on sale (#2321).
  return rows.map(
    ({ trip, siteName, booked, certifiedPassengers, boatCapacity, assignedCrewCount }) => ({
      ...trip,
      siteName,
      capacity: sellableSeats(trip.capacity, certifiedPassengers, boatCapacity, assignedCrewCount),
      booked,
    }),
  );
}

/**
 * **Who is asking when this course next runs.** There are two honest answers
 * and they are not the same date.
 *
 * - `"storefront"` — what a diver may book: live, scheduled, **public**, not a
 *   rehearsal, not on a conditions hold, **with a seat left**, within the
 *   hour's late-arrival buffer. Every such session is in
 *   {@link listUpcomingSessionsForCourse}'s scope, so the shelf never promises
 *   a date the course page then lacks (dive-domain review r4-4, F3).
 * - `"shop"` — what the shop has on its own books, private sessions included.
 *   A course booked out to one family is scheduled; telling the staff who
 *   scheduled it that it is not would be a lie about their own week.
 *
 * No default. A caller that does not say which it means is asking a question
 * with two answers, and the wrong one is silent either way — the storefront
 * would advertise a session nobody may book, or the roster would report a
 * course as unscheduled on the morning it runs.
 */
export type CourseSessionScope = "storefront" | "shop";

/**
 * The next scheduled session per course — one query for a page of them, rather
 * than {@link listUpcomingSessionsForCourse} once per course.
 *
 * Built for the storefront's courses shelf (Harbor — ADR
 * 20260901-diveday-reimagined: the board draws "Starts Sep 7" under a card),
 * and read by the staff roster too, which is why the scope is stated rather
 * than assumed (ADR 20260919-one-idea, decision I · Tide, slice 23g — "a
 * course is sessions on days").
 */
export async function nextSessionStartByCourse(
  db: AppDb,
  shopId: string,
  courseIds: readonly string[],
  scope: CourseSessionScope,
  now: Date = nowDate(),
): Promise<Map<string, Date>> {
  if (courseIds.length === 0) return new Map();
  if (scope === "storefront") return nextSellableSessionByCourse(db, shopId, courseIds, now);
  const rows = await db
    .select({ courseId: trips.courseId, startsAt: sql<Date>`min(${trips.startsAt})` })
    .from(trips)
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, shopId),
        inArray(trips.courseId, [...courseIds]),
        eq(trips.status, "scheduled"),
        gte(trips.startsAt, new Date(now.getTime() - DEPARTURE_BUFFER_MS)),
      ),
    )
    .groupBy(trips.courseId);
  return new Map(
    rows.flatMap((row) => (row.courseId ? [[row.courseId, new Date(row.startsAt)] as const] : [])),
  );
}

/**
 * The storefront's answer: the first session a diver could book today, so a
 * catalog row's "Next Sat, Oct 24" never names one they open to find full
 * (dive-domain review r4-4, F3). Public, never a rehearsal, not on a
 * conditions hold, and with a seat left under the same `having` the board's
 * `hasSpace` uses; a course with none of those has no key, and the catalog
 * asks for a date instead.
 */
async function nextSellableSessionByCourse(
  db: AppDb,
  shopId: string,
  courseIds: readonly string[],
  now: Date,
): Promise<Map<string, Date>> {
  const rows = await db
    .select({ courseId: trips.courseId, startsAt: trips.startsAt })
    .from(trips)
    .leftJoin(bookings, liveBookingJoin)
    .where(
      and(
        liveTrip(),
        notRehearsal(),
        eq(trips.shopId, shopId),
        inArray(trips.courseId, [...courseIds]),
        eq(trips.status, "scheduled"),
        eq(trips.isPrivate, false),
        eq(trips.conditionsHold, false),
        gte(trips.startsAt, new Date(now.getTime() - DEPARTURE_BUFFER_MS)),
      ),
    )
    .groupBy(trips.id)
    .having(hasSpaceHaving(true))
    .orderBy(asc(trips.startsAt));
  const next = new Map<string, Date>();
  for (const row of rows) {
    if (row.courseId && !next.has(row.courseId)) next.set(row.courseId, row.startsAt);
  }
  return next;
}

/** One single-day departure as the week board draws it. */
export type WeekBoardEntry = {
  tripId: string;
  title: string;
  /** A rehearsal departure (ADR 20261012-rehearsal-departures): its own mark, and no price prompt. */
  isRehearsal: boolean;
  startsAt: Date;
  endsAt: Date;
  booked: number;
  capacity: number;
  /** Per seat, as the booking charges it: a course session's is the course total (H-125). */
  priceCents: number | null;
  /**
   * `sailed` once the boat is back — the departure has *ended*, with the
   * standing one-hour late-arrival buffer every "has it sailed" check in this
   * app carries (AGENTS.md). A past column's entries are read, not worked, so
   * this is the one fact that separates the two.
   */
  status: "upcoming" | "sailed";
  courseId: string | null;
  /**
   * The site this departure is diving, and the hull it is on. **What a cell
   * says that its neighbours do not.** Every title in a column shares its
   * prefix ("Dawn Two-Tank — …", "Morning Two-Tank — …") and a 150px column
   * clips exactly the half that differs, so the site leads the cell's meta
   * line instead of being the thing the ellipsis eats. `boatId` is not read
   * by any cell: it is what lets the caller ask the day the stream's own
   * question — more departures than boats, or one hull in two places at once
   * (`src/lib/boats.ts`) — which is the board's whole question and had no
   * answer at desktop.
   */
  diveSiteName: string | null;
  boatId: string | null;
  /** A shore or pool session has no hull to be in two places at once. */
  diveMode: "boat" | "shore" | "pool";
};

/**
 * A multi-day course session as the week board draws it: one bar across the
 * days it owns, never one entry per day. `firstDay`/`lastDay` are the shop's
 * own calendar dates and may sit outside the week being drawn — a course that
 * starts on Sunday and runs into Tuesday is the same object read from either
 * week, and the caller clamps it to the columns it has.
 */
export type WeekBoardSpan = {
  tripId: string;
  title: string;
  firstDay: CalendarDate;
  lastDay: CalendarDate;
  /**
   * The instant the run begins, and how many days it meets on. A span opens
   * the same move/copy/remove panels a day entry does — a course drawn as one
   * bar still has to be movable — and those forms are a date, a time and "all
   * {count} days move together".
   */
  startsAt: Date;
  dayCount: number;
  /**
   * `sailed` once the whole run is behind, with the same one-hour
   * late-arrival buffer a day entry carries: a course still meeting on Friday
   * is not a thing to be told nothing about on Wednesday.
   */
  status: "upcoming" | "sailed";
  booked: number;
  capacity: number;
  /** Per seat, as the booking charges it: a course session's is the course total (H-125). */
  priceCents: number | null;
  instructorName: string | null;
};

/**
 * One week of the staff board, as seven day buckets and the spans that cross
 * them — the desktop reading of the same rows the cursor stream pages
 * (ADR 20260827-clearwater-surface-language, decision 5).
 *
 * **A multi-day departure appears exactly once, as a span.** It is never also
 * dropped into the day cells it covers: a three-day course rendered four times
 * (a bar and three entries) is the same fact said four times, which principle
 * 9 spends this whole redesign removing.
 *
 * Bounded by construction — one week, one shop — so unlike the stream this
 * needs no cursor. It is a *different reading*, not a second stream: nothing
 * here touches `pagedUpcomingTripsWithCounts`'s keyset contract, and the two
 * page by different parameters that deliberately never mix.
 *
 * Reads through `liveTrip()`, so a departure taken off the board is gone from
 * the week as well as from the stream.
 */
export async function weekBoard(
  db: DbExecutor,
  shopId: string,
  weekStartIso: CalendarDate,
  timeZone: string,
  now: Date = nowDate(),
): Promise<{ days: Record<CalendarDate, WeekBoardEntry[]>; spans: WeekBoardSpan[] }> {
  const dayIsos = weekDates(weekStartIso);
  const from = wallTimeToUtc({ ...midnightOf(weekStartIso), hour: 0, minute: 0 }, timeZone);
  const to = wallTimeToUtc(
    { ...midnightOf(shiftWeek(weekStartIso, 1)), hour: 0, minute: 0 },
    timeZone,
  );
  // Every column exists whether or not anything sails in it: an empty cell is
  // the information the grid is for, and a caller that had to invent the gaps
  // would be re-deriving the calendar this query already knows.
  const days: Record<CalendarDate, WeekBoardEntry[]> = Object.fromEntries(
    dayIsos.map((iso) => [iso, [] as WeekBoardEntry[]]),
  );

  // Overlap, not containment: a course that met on Sunday and meets again on
  // Monday belongs to both weeks. The join is on the meeting windows rather
  // than on `trips.startsAt` for exactly that reason.
  const overlapping = await db
    .select({
      trip: trips,
      diveSiteName: diveSites.name,
      certifiedPassengers: tripBoatCertifiedPassengers(),
      boatCapacity: tripBoatCapacity(),
      assignedCrewCount: tripAssignedCrewCount(),
      // `countDistinct`, not `count`: the meeting-window join multiplies a
      // multi-day course's rows by its days, and a plain count would report a
      // three-day class as three times as booked as it is.
      booked: countDistinct(bookings.id),
      // A course session is priced at the course total the booking charges,
      // as the public schedule rows read it (H-125), never the trip row's own.
      course: {
        title: courses.title,
        priceCents: courses.priceCents,
        eLearningPriceCents: courses.eLearningPriceCents,
      },
    })
    .from(trips)
    .innerJoin(tripScheduleDays, eq(tripScheduleDays.tripId, trips.id))
    .leftJoin(diveSites, eq(diveSites.id, tripPrimarySiteId))
    .leftJoin(courses, eq(courses.id, trips.courseId))
    .leftJoin(bookings, liveBookingJoin)
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        lt(tripScheduleDays.startsAt, to),
        gt(tripScheduleDays.endsAt, from),
      ),
    )
    .groupBy(trips.id, diveSites.id, courses.id)
    .orderBy(asc(trips.startsAt), asc(trips.title), asc(trips.id));

  if (overlapping.length === 0) return { days, spans: [] };

  const tripIds = overlapping.map((row) => row.trip.id);
  // Every meeting window of every trip that touched the week, not just the
  // windows inside it: a span has to state the run it really is, and a trip
  // is multi-day or not regardless of how much of it this week can see.
  const dayRows = await db
    .select({
      tripId: tripScheduleDays.tripId,
      dayNumber: tripScheduleDays.dayNumber,
      startsAt: tripScheduleDays.startsAt,
    })
    .from(tripScheduleDays)
    .where(inArray(tripScheduleDays.tripId, tripIds))
    .orderBy(asc(tripScheduleDays.tripId), asc(tripScheduleDays.dayNumber));
  const windowsByTrip = new Map<string, Date[]>();
  for (const row of dayRows) {
    const list = windowsByTrip.get(row.tripId) ?? [];
    list.push(row.startsAt);
    windowsByTrip.set(row.tripId, list);
  }

  const spans: WeekBoardSpan[] = [];
  const sailedBefore = new Date(now.getTime() - DEPARTURE_BUFFER_MS);
  for (const {
    trip,
    diveSiteName,
    booked,
    course,
    certifiedPassengers,
    boatCapacity,
    assignedCrewCount,
  } of overlapping) {
    const priceCents = perDiverBookingPriceCents(trip, course);
    // Sailed rows have no live availability to report, and their crew
    // assignments are not historical snapshots. For current and upcoming
    // departures, show the same passenger ceiling the booking gate enforces.
    const capacity =
      trip.endsAt < sailedBefore
        ? trip.capacity
        : sellableSeats(trip.capacity, certifiedPassengers, boatCapacity, assignedCrewCount);
    // A trip with no meeting rows at all is its own single window — the same
    // reading `tripScheduleDayCounts` callers already take.
    const windows = windowsByTrip.get(trip.id) ?? [trip.startsAt];
    if (windows.length > 1) {
      spans.push({
        tripId: trip.id,
        title: trip.title,
        firstDay: calendarDateInTimezone(windows[0] ?? trip.startsAt, timeZone),
        lastDay: calendarDateInTimezone(windows.at(-1) ?? trip.endsAt, timeZone),
        startsAt: windows[0] ?? trip.startsAt,
        dayCount: windows.length,
        status: trip.endsAt < sailedBefore ? "sailed" : "upcoming",
        booked,
        capacity,
        priceCents,
        instructorName: null,
      });
      continue;
    }
    const dayIso = calendarDateInTimezone(trip.startsAt, timeZone);
    days[dayIso]?.push({
      tripId: trip.id,
      title: trip.title,
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      booked,
      capacity,
      priceCents,
      isRehearsal: trip.isRehearsal,
      status: trip.endsAt < sailedBefore ? "sailed" : "upcoming",
      courseId: trip.courseId,
      diveSiteName,
      boatId: trip.boatId,
      diveMode: trip.diveMode,
    });
  }
  for (const iso of dayIsos) {
    days[iso]?.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }

  if (spans.length > 0) {
    // Who is teaching it — the one fact a course bar carries that a departure
    // entry does not, and the reason a shop looks at the bar at all. One
    // batched read for the spans only; the day entries never ask.
    const teachers = await db
      .select({
        tripId: tripAssignments.tripId,
        name: people.fullName,
        role: personRoles.role,
      })
      .from(tripAssignments)
      .innerJoin(people, eq(people.id, tripAssignments.personId))
      .leftJoin(personRoles, eq(personRoles.personId, people.id))
      .where(
        inArray(
          tripAssignments.tripId,
          spans.map((span) => span.tripId),
        ),
      )
      .orderBy(asc(people.fullName));
    for (const span of spans) {
      const crew = teachers.filter((row) => row.tripId === span.tripId);
      span.instructorName =
        crew.find((row) => row.role === "instructor")?.name ?? crew[0]?.name ?? null;
    }
  }

  return { days, spans };
}

/** A calendar date as the wall-clock parts `wallTimeToUtc` reads — midnight, shop-local. */
function midnightOf(date: CalendarDate): { year: number; month: number; day: number } {
  const [year, month, day] = date.split("-").map(Number);
  return { year: year ?? 1970, month: month ?? 1, day: day ?? 1 };
}
