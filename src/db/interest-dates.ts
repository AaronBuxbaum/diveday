import { and, asc, count, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { sellableSeats } from "@/lib/boat-safety";
import { type CalendarDate, calendarDateInTimezone, shiftCalendarDate } from "@/lib/calendar-date";
import type { CourseInquiryExperience } from "@/lib/course-inquiry";
import {
  type DateRequestMatch,
  type DateRequestOutcome,
  dateRequestMatchFor,
  FLEXIBLE_WINDOW_DAYS,
} from "@/lib/date-requests";
import { normalizeEmailAddress } from "@/lib/inbox";
import { wallTimeToUtc } from "@/lib/zoned";
import type { DbExecutor } from "./client";
import { type OffsetPage, offsetPage, PAGE_SIZE } from "./paging";
import { bookings, courses, interests, people, shops, trips } from "./schema";
import { liveTrip, notRehearsal } from "./trips-live";
import {
  liveBookingJoin,
  tripAssignedCrewCount,
  tripBoatCapacity,
  tripBoatCertifiedPassengers,
} from "./trips-queries";

/**
 * **The date scope's reads** (ADR 20261017-one-interest-with-a-scope): `/requests`,
 * the board's "asked" row, the booking flow's `?request=` context, the weekly
 * digest's count and the trip panel's "within reach" group. The writer is
 * `askForDate` in `./interests.ts`. Every read is `scope = 'date'` and carries its
 * own `shop_id`.
 */

/**
 * One date interest as the staff surfaces draw it. Codes and facts only: the
 * grouping is `groupDateRequests` in src/lib/date-requests.ts and the words are
 * the staff bundle's.
 */
export type DateInterestRow = {
  id: string;
  courseId: string | null;
  courseTitle: string | null;
  /** Set exactly when there is no course. */
  interest: string | null;
  personId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  experienceLevel: CourseInquiryExperience | null;
  timing: string | null;
  preferredDate: CalendarDate | null;
  alternateDate: CalendarDate | null;
  dateFlexible: boolean;
  /** The asker and whoever dives with them; null when left blank. */
  partySize: number | null;
  message: string | null;
  askedAt: Date;
  /** Null while the interest is open (third UX review, item 13). */
  closedAt: Date | null;
  closedAs: DateRequestOutcome | null;
};

const dateInterestColumns = {
  id: interests.id,
  courseId: interests.courseId,
  courseTitle: courses.title,
  interest: interests.interest,
  personId: interests.personId,
  name: interests.name,
  email: interests.email,
  phone: interests.phone,
  experienceLevel: interests.experienceLevel,
  timing: interests.timing,
  preferredDate: interests.preferredDate,
  alternateDate: interests.alternateDate,
  dateFlexible: interests.dateFlexible,
  partySize: interests.partySize,
  message: interests.message,
  askedAt: interests.askedAt,
  closedAt: interests.closedAt,
  closedAs: interests.closedAs,
};

/** A date interest is only ever closed `booked` or `done`; `unsubscribed` is an anytime interest's. */
function asDateInterest<T extends { closedAs: string | null }>(
  row: T,
): Omit<T, "closedAs"> & { closedAs: DateRequestOutcome | null } {
  return {
    ...row,
    closedAs: row.closedAs === "booked" || row.closedAs === "done" ? row.closedAs : null,
  };
}

/**
 * **Every request names the diver it came from, when the shop has them on
 * file** — whenever the diver joined the roster.
 *
 * `person_id` is snapshotted at write time, so a request sent *before* the
 * diver's record existed stayed unlinked for good. Each reader resolves an
 * unlinked row at read time with the inbox's own email rule
 * (`matchPersonByAddress`): an exact match on the lowercased address, live and
 * un-erased divers of this shop only, the oldest winning among duplicates.
 * **Email only, never the phone**: a household number is genuinely shared, and a
 * partner's request would open the wrong diver's record. The stored column is
 * left as written; erasure reaches these rows by address anyway.
 */
async function withRosterLinks<T extends { personId: string | null; email: string | null }>(
  db: DbExecutor,
  shopId: string,
  rows: T[],
): Promise<T[]> {
  const emails = [
    ...new Set(
      rows
        .filter((row) => !row.personId)
        .map((row) => normalizeEmailAddress(row.email))
        .filter((email): email is string => Boolean(email)),
    ),
  ];
  if (emails.length === 0) return rows;
  // One read for the page. Oldest first, so the first id kept per address is
  // the record the shop has used longest.
  const matches = await db
    .select({ id: people.id, email: sql<string>`lower(${people.email})` })
    .from(people)
    .where(
      and(
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        inArray(sql`lower(${people.email})`, emails),
      ),
    )
    .orderBy(asc(people.createdAt));
  const byEmail = new Map<string, string>();
  for (const match of matches) if (!byEmail.has(match.email)) byEmail.set(match.email, match.id);
  return rows.map((row) => {
    if (row.personId) return row;
    const email = normalizeEmailAddress(row.email);
    const personId = email ? byEmail.get(email) : undefined;
    return personId ? { ...row, personId } : row;
  });
}

/** How many requests one page of the staff list holds. */
export const DATE_REQUESTS_PAGE_SIZE = PAGE_SIZE.list;

const openDateInterest = (shopId: string) =>
  and(eq(interests.shopId, shopId), eq(interests.scope, "date"), isNull(interests.closedAt));

/**
 * How many of this shop's date interests nobody has closed yet: the page's own
 * total, and what Today adds to its one unanswered count (issue #2658).
 */
export async function countOpenDateInterests(db: DbExecutor, shopId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(interests).where(openDateInterest(shopId));
  return row?.n ?? 0;
}

/**
 * **What still waits on the shop as a request**, for Today's one unanswered
 * count and the Requests page's door. A shop that switched date requests off
 * (`shops.date_requests_enabled`) still hears its course pages' inquiries,
 * which are how a course converts and never part of that switch, so only
 * those count then; the shopfront's day asks it no longer takes do not.
 */
export async function countWaitingDateInterests(db: DbExecutor, shopId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(interests)
    .innerJoin(shops, eq(shops.id, interests.shopId))
    .where(
      and(
        openDateInterest(shopId),
        or(eq(shops.dateRequestsEnabled, true), isNotNull(interests.courseId)),
      ),
    );
  return row?.n ?? 0;
}

/**
 * One page of this shop's open date interests, ordered by the date they are asking
 * for — soonest first, and the ones that named no date at all last, which is
 * the order the page groups them in.
 *
 * Ordered by the *earliest* date an interest names rather than by `preferred_date`
 * alone: a request whose alternate falls before its first choice still belongs
 * beside the day it can first be served. Offset paging like every other staff
 * list (ADR 20260803-one-pagination-model); the count shares this query's scope
 * exactly.
 */
export async function listOpenDateInterests(
  db: DbExecutor,
  shopId: string,
  options: { page?: number } = {},
): Promise<OffsetPage<DateInterestRow>> {
  const firstDate = sql`least(${interests.preferredDate}, ${interests.alternateDate})`;
  return offsetPage<DateInterestRow>({
    page: options.page,
    pageSize: DATE_REQUESTS_PAGE_SIZE,
    countRows: () => countOpenDateInterests(db, shopId),
    fetchRows: async (offset, limit) =>
      withRosterLinks(
        db,
        shopId,
        (
          await db
            .select(dateInterestColumns)
            .from(interests)
            .leftJoin(courses, eq(courses.id, interests.courseId))
            .where(openDateInterest(shopId))
            .orderBy(
              sql`${firstDate} asc nulls last`,
              desc(interests.askedAt),
              asc(interests.name),
              asc(interests.id),
            )
            .limit(limit)
            .offset(offset)
        ).map(asDateInterest),
      ),
  });
}

/**
 * Loads the small, explicitly selected set a Requests link carries into the
 * schedule builder. The shop and ids are both checked here; the query string is
 * navigation context, never an authorization boundary.
 */
export async function listDateInterestsByIds(
  db: DbExecutor,
  shopId: string,
  interestIds: string[],
): Promise<DateInterestRow[]> {
  const ids = [...new Set(interestIds)];
  if (ids.length === 0) return [];
  const rows = await db
    .select(dateInterestColumns)
    .from(interests)
    .leftJoin(courses, eq(courses.id, interests.courseId))
    .where(
      and(eq(interests.shopId, shopId), eq(interests.scope, "date"), inArray(interests.id, ids)),
    )
    .orderBy(desc(interests.askedAt), asc(interests.name), asc(interests.id));
  return withRosterLinks(db, shopId, rows.map(asDateInterest));
}

/**
 * Open date interests that named one of the supplied calendar dates. Callers may
 * pass a small expanded window so flexible interests can be filtered with
 * `dateRequestMatchFor` using the same rules as the Requests page.
 */
export async function listOpenDateInterestsForDates(
  db: DbExecutor,
  shopId: string,
  dates: CalendarDate[],
): Promise<DateInterestRow[]> {
  const uniqueDates = [...new Set(dates)];
  if (uniqueDates.length === 0) return [];
  const rows = await db
    .select(dateInterestColumns)
    .from(interests)
    .leftJoin(courses, eq(courses.id, interests.courseId))
    .where(
      and(
        // An answered interest no longer asks for the day (third UX review, item 13).
        openDateInterest(shopId),
        or(
          inArray(interests.preferredDate, uniqueDates),
          inArray(interests.alternateDate, uniqueDates),
        ),
      ),
    )
    .orderBy(desc(interests.askedAt), asc(interests.name), asc(interests.id));
  return withRosterLinks(db, shopId, rows.map(asDateInterest));
}

/** How many closed requests the Requests page lists under "Done". */
export const HANDLED_DATE_REQUESTS_SHOWN = 20;

/**
 * **The date interests the shop has closed, newest first** (third UX review, item
 * 13): the "Done" list under the open days, capped, because the page is a
 * worklist and the closed ones are there to reopen a mistake rather than to read.
 */
export async function listClosedDateInterests(
  db: DbExecutor,
  shopId: string,
  limit: number = HANDLED_DATE_REQUESTS_SHOWN,
): Promise<DateInterestRow[]> {
  const rows = await db
    .select(dateInterestColumns)
    .from(interests)
    .leftJoin(courses, eq(courses.id, interests.courseId))
    .where(
      and(
        eq(interests.shopId, shopId),
        eq(interests.scope, "date"),
        isNotNull(interests.closedAt),
        inArray(interests.closedAs, ["booked", "done"]),
      ),
    )
    .orderBy(desc(interests.closedAt), asc(interests.name), asc(interests.id))
    .limit(limit);
  return withRosterLinks(db, shopId, rows.map(asDateInterest));
}

/** A public departure on a day a date interest asked for ("On the board"). */
export type DepartureOnTheBoard = {
  tripId: string;
  title: string;
  startsAt: Date;
  /** The shop's own calendar date it sails on. */
  date: CalendarDate;
  /** Seats a diver could still book, measured as the booking door measures them. */
  seatsLeft: number;
};

/**
 * **Departures already on the board for these days**, so a day group on
 * `/requests` can say "On the board: Sat 14 · Wrecks · 3 seats" instead of
 * listing its interests as if nothing existed for them. Scheduled, live, not a
 * rehearsal (a rehearsal is private and appears nowhere a diver or a request
 * reads). Bounded by the dates asked, in the shop's own zone; earliest first.
 */
export async function listDeparturesOnDates(
  db: DbExecutor,
  shopId: string,
  dates: CalendarDate[],
  timeZone: string,
): Promise<DepartureOnTheBoard[]> {
  const wanted = new Set(dates);
  if (wanted.size === 0) return [];
  const sorted = [...wanted].sort();
  const first = sorted[0] as CalendarDate;
  const last = sorted[sorted.length - 1] as CalendarDate;
  const midnight = (date: CalendarDate) => {
    const [year, month, day] = date.split("-").map(Number);
    return wallTimeToUtc(
      { year: year ?? 1970, month: month ?? 1, day: day ?? 1, hour: 0, minute: 0 },
      timeZone,
    );
  };
  const rows = await db
    .select({
      trip: trips,
      booked: count(bookings.id),
      certifiedPassengers: tripBoatCertifiedPassengers(),
      boatCapacity: tripBoatCapacity(),
      assignedCrewCount: tripAssignedCrewCount(),
    })
    .from(trips)
    .leftJoin(bookings, liveBookingJoin)
    .where(
      and(
        liveTrip(),
        notRehearsal(),
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        sql`${trips.startsAt} >= ${midnight(first)}`,
        sql`${trips.startsAt} < ${midnight(shiftCalendarDate(last, 1))}`,
      ),
    )
    .groupBy(trips.id)
    .orderBy(asc(trips.startsAt), asc(trips.title), asc(trips.id));
  return rows.flatMap((row) => {
    const date = calendarDateInTimezone(row.trip.startsAt, timeZone);
    if (!wanted.has(date)) return [];
    const seats = sellableSeats(
      row.trip.capacity,
      row.certifiedPassengers,
      row.boatCapacity,
      row.assignedCrewCount,
    );
    return [
      {
        tripId: row.trip.id,
        title: row.trip.title,
        startsAt: row.trip.startsAt,
        date,
        seatsLeft: Math.max(0, seats - row.booked),
      },
    ];
  });
}

/** An open date interest that could make a departure, and what it already has there. */
export type DateInterestInReach = DateInterestRow & {
  /** Why it reaches this date: its own choice, its fallback, or a flexible neighbour. */
  match: DateRequestMatch;
  /**
   * The departure child row this interest already has on the trip (an interest attached
   * from the schedule builder, or offered a seat here), else null. `offeredAt`
   * null means attached but not yet offered. The panel reads "offered" off this.
   */
  departureInterestId: string | null;
  offeredAt: Date | null;
};

const departureChild = alias(interests, "departure_child");

/**
 * **The trip panel's second group: open date interests within reach of a
 * departure.** Reach is `dateRequestMatchFor`, the rule `/requests` groups by:
 * the interest's preferred or alternate date is the departure's day, or the interest is
 * flexible and a date it named is within `FLEXIBLE_WINDOW_DAYS` of it.
 *
 * `target` is a departure (`tripId`, read in this shop and live; null when it is
 * not) or a calendar date in the shop's own zone (`date`). A caller that has
 * already read the live departure hands its `day` with the `tripId`, so the
 * trip page does not wait on a second read of the same row (staff render cost).
 * Rows keep the order people asked in (ADR 20260813): never ranked or filtered
 * by fit.
 */
export async function listDateInterestsInReach(
  db: DbExecutor,
  shopId: string,
  target: { tripId: string; day?: CalendarDate } | { date: CalendarDate },
): Promise<DateInterestInReach[]> {
  let tripId: string | null = null;
  let day: CalendarDate;
  if ("tripId" in target && target.day) {
    tripId = target.tripId;
    day = target.day;
  } else if ("tripId" in target) {
    const [row] = await db
      .select({ startsAt: trips.startsAt, timezone: shops.timezone })
      .from(trips)
      .innerJoin(shops, eq(shops.id, trips.shopId))
      .where(and(eq(trips.id, target.tripId), eq(trips.shopId, shopId), liveTrip()))
      .limit(1);
    if (!row) return [];
    tripId = target.tripId;
    day = calendarDateInTimezone(row.startsAt, row.timezone);
  } else {
    day = target.date;
  }
  const lo = shiftCalendarDate(day, -FLEXIBLE_WINDOW_DAYS);
  const hi = shiftCalendarDate(day, FLEXIBLE_WINDOW_DAYS);
  const near = (column: typeof interests.preferredDate) =>
    and(isNotNull(column), sql`${column} between ${lo} and ${hi}`);
  const rows = await db
    .select({
      ...dateInterestColumns,
      departureInterestId: departureChild.id,
      offeredAt: departureChild.offeredAt,
    })
    .from(interests)
    .leftJoin(courses, eq(courses.id, interests.courseId))
    .leftJoin(
      departureChild,
      and(
        eq(departureChild.parentInterestId, interests.id),
        eq(departureChild.shopId, shopId),
        eq(departureChild.scope, "departure"),
        tripId ? eq(departureChild.tripId, tripId) : sql`false`,
      ),
    )
    .where(
      and(
        openDateInterest(shopId),
        or(near(interests.preferredDate), near(interests.alternateDate)),
      ),
    )
    .orderBy(asc(interests.askedAt), asc(interests.name), asc(interests.id));
  const linked = await withRosterLinks(db, shopId, rows.map(asDateInterest));
  return linked.flatMap((row) => {
    const match = dateRequestMatchFor(row, day);
    return match ? [{ ...row, match }] : [];
  });
}
