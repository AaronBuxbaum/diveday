import {
  and,
  count,
  countDistinct,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  sql,
} from "drizzle-orm";
import { liveTrip, notRehearsal } from "@/db/trips";

export { canPersonViewShopReports } from "@/features/reports/reporting";

import type { DbExecutor } from "../../db/client";
import { queryAll } from "../../db/query-helpers";
import { bookings, cards, courses, interests, trips, waiverRecords } from "../../db/schema/index";

/**
 * **The owner's few numbers**, each a plain SQL aggregate over rows the shop already holds
 * (issue #4262). Informational only: nothing here gates boarding, changes a medical rule or
 * messages a diver. Every figure reads zero or null for a shop with nothing in the window, and the
 * page draws that as an empty state.
 *
 * One window, the last 12 months to `now`, over departures that have started.
 */
export const OWNER_STATS_WINDOW_DAYS = 365;

export type OwnerStats = {
  /** Divers with a seat on a departure in the window, and how many had two or more. */
  repeat: { divers: number; repeat: number };
  /** Per course with anything in the window: asked about, seated, issued a card at its departure. */
  courses: { courseId: string; title: string; asked: number; booked: number; certified: number }[];
  /**
   * Medical reviews staff cleared in the window, the median hours from the diver's signature to the
   * clearance, and the reviews still open now.
   */
  medical: { cleared: number; medianHours: number | null; waiting: number };
  /** Seats whose diver had a current signed waiver by the time the boat left. */
  waivers: { seats: number; signedByDeparture: number };
  /** Departures with a seat whose every seat had its waiver in before the shop's day of the trip. */
  departures: { counted: number; ready: number };
};

const DAY_MS = 86_400_000;
const ACTIVE = ["booked"] as const;

export async function readOwnerStats(
  db: DbExecutor,
  shopId: string,
  input: { now: Date; timeZone: string },
): Promise<OwnerStats> {
  const { now, timeZone } = input;
  const since = new Date(now.getTime() - OWNER_STATS_WINDOW_DAYS * DAY_MS);
  const inWindow = and(
    eq(trips.shopId, shopId),
    liveTrip(),
    notRehearsal(),
    eq(trips.status, "scheduled"),
    gte(trips.startsAt, since),
    lt(trips.startsAt, now),
  );

  const [repeat, funnel, medical, seatsWaivers] = await queryAll<
    [OwnerStats["repeat"], OwnerStats["courses"], OwnerStats["medical"], SeatWaiverRows]
  >(db, [
    () => readRepeat(db, shopId, inWindow),
    () => readCourseFunnel(db, shopId, inWindow, since, now),
    () => readMedical(db, shopId, since, now),
    () => readSeatWaivers(db, shopId, inWindow, timeZone),
  ]);

  return {
    repeat,
    courses: funnel,
    medical,
    waivers: { seats: seatsWaivers.seats, signedByDeparture: seatsWaivers.signedByDeparture },
    departures: { counted: seatsWaivers.departures, ready: seatsWaivers.readyDepartures },
  };
}

async function readRepeat(db: DbExecutor, shopId: string, inWindow: ReturnType<typeof and>) {
  const perDiver = db
    .select({ departures: countDistinct(bookings.tripId).as("departures") })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(and(inWindow, eq(bookings.shopId, shopId), inArray(bookings.status, [...ACTIVE])))
    .groupBy(bookings.personId)
    .as("per_diver");
  const [row] = await db
    .select({
      divers: count(),
      repeat: sql<number>`count(*) filter (where ${perDiver.departures} > 1)`.mapWith(Number),
    })
    .from(perDiver);
  return { divers: row?.divers ?? 0, repeat: row?.repeat ?? 0 };
}

async function readCourseFunnel(
  db: DbExecutor,
  shopId: string,
  inWindow: ReturnType<typeof and>,
  since: Date,
  now: Date,
): Promise<OwnerStats["courses"]> {
  const [asked, booked, certified] = await queryAll<
    [
      { courseId: string | null; n: number }[],
      { courseId: string | null; n: number }[],
      { courseId: string | null; n: number }[],
    ]
  >(db, [
    () =>
      db
        .select({ courseId: interests.courseId, n: count() })
        .from(interests)
        .where(
          and(
            eq(interests.shopId, shopId),
            isNotNull(interests.courseId),
            gte(interests.askedAt, since),
            lt(interests.askedAt, now),
          ),
        )
        .groupBy(interests.courseId),
    () =>
      db
        .select({ courseId: trips.courseId, n: countDistinct(bookings.personId) })
        .from(bookings)
        .innerJoin(trips, eq(trips.id, bookings.tripId))
        .where(
          and(
            inWindow,
            isNotNull(trips.courseId),
            eq(bookings.shopId, shopId),
            inArray(bookings.status, [...ACTIVE]),
          ),
        )
        .groupBy(trips.courseId),
    () =>
      db
        .select({ courseId: trips.courseId, n: countDistinct(cards.personId) })
        .from(cards)
        .innerJoin(trips, eq(trips.id, cards.issuedFromTripId))
        .where(
          and(
            inWindow,
            isNotNull(trips.courseId),
            eq(cards.shopId, shopId),
            isNull(cards.deletedAt),
            isNotNull(cards.issuedByShopAt),
          ),
        )
        .groupBy(trips.courseId),
  ]);

  const ids = new Set<string>();
  for (const rows of [asked, booked, certified])
    for (const row of rows) if (row.courseId) ids.add(row.courseId);
  if (ids.size === 0) return [];

  const titles = await db
    .select({ id: courses.id, title: courses.title })
    .from(courses)
    .where(and(eq(courses.shopId, shopId), inArray(courses.id, [...ids])));
  const pick = (rows: { courseId: string | null; n: number }[], id: string) =>
    Number(rows.find((row) => row.courseId === id)?.n ?? 0);
  return titles
    .map(({ id, title }) => ({
      courseId: id,
      title,
      asked: pick(asked, id),
      booked: pick(booked, id),
      certified: pick(certified, id),
    }))
    .sort((a, b) => b.booked - a.booked || a.title.localeCompare(b.title, "en"));
}

async function readMedical(
  db: DbExecutor,
  shopId: string,
  since: Date,
  now: Date,
): Promise<OwnerStats["medical"]> {
  const [cleared] = await db
    .select({
      cleared: count(),
      medianHours: sql<
        number | null
      >`percentile_cont(0.5) within group (order by extract(epoch from ${waiverRecords.medicalClearedAt} - ${waiverRecords.signedAt}) / 3600.0)`.mapWith(
        (value) => (value === null ? null : Number(value)),
      ),
    })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        eq(waiverRecords.medicalReviewRequired, true),
        isNotNull(waiverRecords.signedAt),
        gte(waiverRecords.medicalClearedAt, since),
        lt(waiverRecords.medicalClearedAt, now),
      ),
    );
  const [waiting] = await db
    .select({ n: count() })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        eq(waiverRecords.status, "completed"),
        eq(waiverRecords.medicalReviewRequired, true),
        isNull(waiverRecords.medicalClearedAt),
        isNull(waiverRecords.medicalClearanceDeclinedAt),
        isNull(waiverRecords.supersededAt),
      ),
    );
  return {
    cleared: cleared?.cleared ?? 0,
    medianHours: cleared?.medianHours ?? null,
    waiting: waiting?.n ?? 0,
  };
}

type SeatWaiverRows = {
  seats: number;
  signedByDeparture: number;
  departures: number;
  readyDepartures: number;
};

/**
 * One row per active seat on a departure in the window, with two facts: a current signed waiver by
 * the time the boat left, and one in before the start of the shop's day of the trip. The seat rule
 * is the monthly report's (`monthlyWaiverRows`): a completed, current waiver at the shop.
 */
async function readSeatWaivers(
  db: DbExecutor,
  shopId: string,
  inWindow: ReturnType<typeof and>,
  timeZone: string,
): Promise<SeatWaiverRows> {
  const waiverBy = (cutoff: ReturnType<typeof sql>) => sql<boolean>`exists (
    select 1 from ${waiverRecords}
    where ${waiverRecords.shopId} = ${shopId}
      and ${waiverRecords.personId} = ${bookings.personId}
      and ${waiverRecords.status} = 'completed'
      and ${waiverRecords.supersededAt} is null
      and ${waiverRecords.signedAt} <= ${cutoff}
  )`;
  const dayStart = sql`(date_trunc('day', ${trips.startsAt} at time zone ${timeZone}) at time zone ${timeZone})`;
  // The strict "before the day" is a signature at or before the day's first instant minus a tick.
  const beforeDay = sql`(${dayStart} - interval '1 microsecond')`;
  const perSeat = db
    .select({
      tripId: trips.id,
      byDeparture: waiverBy(sql`${trips.startsAt}`).as("by_departure"),
      beforeDay: waiverBy(beforeDay).as("before_day"),
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(and(inWindow, eq(bookings.shopId, shopId), inArray(bookings.status, [...ACTIVE])))
    .as("per_seat");
  const [seats] = await db
    .select({
      seats: count(),
      signedByDeparture: sql<number>`count(*) filter (where ${perSeat.byDeparture})`.mapWith(
        Number,
      ),
    })
    .from(perSeat);
  const perTrip = db
    .select({ ready: sql<boolean>`bool_and(${perSeat.beforeDay})`.as("ready") })
    .from(perSeat)
    .groupBy(perSeat.tripId)
    .as("per_trip");
  const [departures] = await db
    .select({
      departures: count(),
      ready: sql<number>`count(*) filter (where ${perTrip.ready})`.mapWith(Number),
    })
    .from(perTrip);
  return {
    seats: seats?.seats ?? 0,
    signedByDeparture: seats?.signedByDeparture ?? 0,
    departures: departures?.departures ?? 0,
    readyDepartures: departures?.ready ?? 0,
  };
}
