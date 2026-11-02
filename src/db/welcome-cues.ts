import { and, eq, inArray, isNotNull, lt, max, ne, notInArray, type SQL, sql } from "drizzle-orm";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { diveDayOrdinal } from "@/lib/prior-visits";
import { hasReturned } from "@/lib/trips";
import type { WelcomeHello } from "@/lib/welcome-cue";
import type { AppDb, DbExecutor } from "./client";
import { numberedDiveDay } from "./dive-days";
import { queryAll } from "./query-helpers";
import { bookings, people, priorVisits, shops, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * The welcome cue's facts (issue #1182, delight report D22).
 *
 * Two values per seat and nothing else: whether the diver said the crew may
 * know, and when they were last on one of this shop's boats. What those add up
 * to is `welcomeCueFor` in `src/lib/welcome-cue.ts` — this module returns rows,
 * never a cue and never a sentence.
 */

export type WelcomeCueInputs = {
  sharedAt: Date | null;
  /**
   * The start of this person's latest earlier seat that counts: for a diver,
   * a seat they dived; for a snorkeler or a rider, any seat they sat in.
   */
  lastDivedAt: Date | null;
  /** This seat is a snorkeler's or a rider's: its words never say "dive". */
  nonDiver: boolean;
  /** What the diver chose to add (#2425). Null whenever `sharedAt` is: no consent, no choice. */
  hello: WelcomeHello | null;
  /**
   * Which dive day with the shop this departure's day is, for a diver seat:
   * `diveDayOrdinal` over their dive days (`numberedDiveDay()`) and imported visits,
   * through this departure's own local day. The recap's own count, so the
   * crew and the diver are told one number. Null on a snorkeler's or a
   * rider's seat. Feeds the milestone (H-20261014-boat-count-milestones).
   */
  diveDayCount: number | null;
};

/**
 * Every earlier seat a person actually sat in with this shop, on a departure
 * that has started: never a cancelled seat or a no-show, who never got wet.
 * Two starts per person, because the seat being greeted decides which counts:
 * a diver's "first dive with us" counts only diving seats, and a snorkeler's or
 * a rider's "first time with us" counts any (dive-domain review of layer r4-5,
 * note 7).
 */
function priorSeats(db: DbExecutor, shopId: string, otherTrips: SQL, now: Date) {
  return db
    .select({
      personId: bookings.personId,
      lastDiveAt:
        sql<Date | null>`max(case when ${bookings.participantType} = 'diver' then ${trips.startsAt} end)`
          .mapWith(trips.startsAt)
          .as("last_dive_at"),
      lastSeatAt: max(trips.startsAt).as("last_seat_at"),
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        otherTrips,
        notInArray(bookings.status, ["cancelled", "no_show"]),
        lt(trips.startsAt, now),
      ),
    )
    .groupBy(bookings.personId)
    .as("prior");
}

/** The prior seat that counts for this one: a dive for a diver, any seat otherwise. */
function lastCounted(
  row: {
    bookingId: string;
    participantType: string;
    lastDiveAt: Date | null;
    lastSeatAt: Date | null;
  },
  counts: ReadonlyMap<string, number>,
): Pick<WelcomeCueInputs, "lastDivedAt" | "nonDiver" | "diveDayCount"> {
  const nonDiver = row.participantType !== "diver";
  return {
    lastDivedAt: (nonDiver ? row.lastSeatAt : row.lastDiveAt) ?? null,
    nonDiver,
    diveDayCount: nonDiver ? null : (counts.get(row.bookingId) ?? null),
  };
}

/**
 * **Which dive day each diver seat's departure is** (H-20261014-boat-count-milestones; dive-domain review
 * of layer r5-4, fix 2): `diveDayOrdinal` over the person's dive days by the
 * one rule (`numberedDiveDay()`) and their imported visits, through that departure's
 * own local day. Not "before now": two boats ahead carry two numbers, and the
 * recap later stamps the same one. A snorkeler's or a rider's seat has none.
 */
async function diveDayCountsForSeats(
  db: DbExecutor,
  shopId: string,
  seats: readonly {
    bookingId: string;
    personId: string;
    participantType: string;
    startsAt: Date;
    /** The shop's zone, read with the seat so the count costs no read of its own. */
    timezone: string;
  }[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const divers = seats.filter((seat) => seat.participantType === "diver");
  const personIds = [...new Set(divers.map((seat) => seat.personId))];
  if (personIds.length === 0) return counts;
  const [days, visits] = await queryAll(db, [
    () =>
      db
        .select({ personId: bookings.personId, startsAt: trips.startsAt })
        .from(bookings)
        .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId)))
        .where(
          and(
            eq(bookings.shopId, shopId),
            inArray(bookings.personId, personIds),
            numberedDiveDay(),
          ),
        ),
    () =>
      db
        .select({
          personId: priorVisits.personId,
          visitedOn: priorVisits.visitedOn,
          statusLabel: priorVisits.statusLabel,
        })
        .from(priorVisits)
        .where(and(eq(priorVisits.shopId, shopId), inArray(priorVisits.personId, personIds))),
  ]);
  for (const seat of divers) {
    counts.set(
      seat.bookingId,
      diveDayOrdinal({
        diveDayStarts: days.filter((day) => day.personId === seat.personId).map((d) => d.startsAt),
        visits: visits.filter((visit) => visit.personId === seat.personId),
        timezone: seat.timezone,
        throughDay: calendarDateInTimezone(seat.startsAt, seat.timezone),
      }),
    );
  }
  return counts;
}

/**
 * One query for the whole departure: each live seat's consent stamp, and the
 * start of that diver's most recent already-departed booking with this shop.
 *
 * The "already departed" half is a seat the person sat in on a trip that has
 * started (`priorSeats`: no cancelled seat, no no-show, and for a diver only a
 * seat they dived). It deliberately looks at **every** such seat, including
 * one on a departure that was later cancelled after sailing: the question is
 * whether this shop has met them, not whether a row is tidy.
 */
export async function welcomeCueInputsByBooking(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  now: Date = nowDate(),
  /**
   * Whether to count each diver's dive days (`diveDayCount`). The diver's own
   * page reads only the gap and says no milestone from here, so it skips the
   * two reads the count costs; every staff reader keeps it.
   */
  options: { diveDayCounts: boolean } = { diveDayCounts: true },
): Promise<Map<string, WelcomeCueInputs>> {
  const prior = priorSeats(db, shopId, ne(bookings.tripId, tripId), now);

  const rows = await db
    .select({
      bookingId: bookings.id,
      personId: bookings.personId,
      sharedAt: bookings.welcomeSharedAt,
      participantType: bookings.participantType,
      lastDiveAt: prior.lastDiveAt,
      lastSeatAt: prior.lastSeatAt,
      hello: bookings.welcomeHello,
      startsAt: trips.startsAt,
      timezone: shops.timezone,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .leftJoin(prior, eq(prior.personId, bookings.personId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, tripId),
        ne(bookings.status, "cancelled"),
        eq(trips.shopId, shopId),
        liveTrip(),
      ),
    );

  const counts = options.diveDayCounts
    ? await diveDayCountsForSeats(db, shopId, rows)
    : new Map<string, number>();
  return new Map(
    rows.map((row) => [
      row.bookingId,
      {
        sharedAt: row.sharedAt,
        ...lastCounted(row, counts),
        // Gated here as well as at the write: a choice without a consent stamp
        // is never read, whatever the row holds.
        hello: row.sharedAt ? row.hello : null,
      },
    ]),
  );
}

export type SharedWelcomeSeat = {
  tripId: string;
  bookingId: string;
  personName: string;
  sharedAt: Date;
} & Pick<WelcomeCueInputs, "lastDivedAt" | "nonDiver" | "diveDayCount">;

/**
 * Every **consented** seat across a set of departures, with the name to greet
 * and the gap to greet them about — the shop home's Say hello row (issue #1182).
 *
 * Filtered to consented seats in SQL rather than read whole and filtered after:
 * a departure with nobody who said yes contributes no rows at all, which on
 * most mornings is every departure, and the home's queue is assembled on every
 * page load.
 */
export async function sharedWelcomeSeatsByTrip(
  db: DbExecutor,
  shopId: string,
  tripIds: readonly string[],
  now: Date = nowDate(),
): Promise<Map<string, SharedWelcomeSeat[]>> {
  const byTrip = new Map<string, SharedWelcomeSeat[]>();
  if (tripIds.length === 0) return byTrip;

  const prior = priorSeats(db, shopId, notInArray(bookings.tripId, [...tripIds]), now);

  const rows = await db
    .select({
      tripId: bookings.tripId,
      bookingId: bookings.id,
      personId: bookings.personId,
      personName: people.fullName,
      sharedAt: bookings.welcomeSharedAt,
      participantType: bookings.participantType,
      lastDiveAt: prior.lastDiveAt,
      lastSeatAt: prior.lastSeatAt,
      startsAt: trips.startsAt,
      timezone: shops.timezone,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .leftJoin(prior, eq(prior.personId, bookings.personId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        inArray(bookings.tripId, [...tripIds]),
        ne(bookings.status, "cancelled"),
        isNotNull(bookings.welcomeSharedAt),
        eq(trips.shopId, shopId),
        liveTrip(),
      ),
    )
    .orderBy(people.fullName, bookings.id);

  const counts = await diveDayCountsForSeats(db, shopId, rows);
  for (const row of rows) {
    if (!row.sharedAt) continue;
    const seats = byTrip.get(row.tripId) ?? [];
    seats.push({
      tripId: row.tripId,
      bookingId: row.bookingId,
      personName: row.personName,
      sharedAt: row.sharedAt,
      ...lastCounted(row, counts),
    });
    byTrip.set(row.tripId, seats);
  }
  return byTrip;
}

export type SetWelcomeConsentResult =
  | { ok: true }
  | { ok: false; reason: "unknown_booking" | "trip_over" };

/**
 * The diver's own answer, from their own readiness link, and the only writer of
 * this column — staff have no door to it anywhere.
 *
 * Refused once the boat is home: a consent given to a crew that has already
 * gone ashore has nobody to reach, and letting it be set afterwards would make
 * the stamp look like a standing preference rather than permission for a day.
 * The same one-hour late-arrival buffer every other departure check uses.
 */
export async function setWelcomeConsent(
  db: AppDb,
  input: {
    shopId: string;
    bookingId: string;
    shared: boolean;
    /**
     * What the diver chose to add (#2425). Kept only with a consent: `shared:
     * false` clears it whatever is passed. Absent leaves a consented seat's
     * choice as it is.
     */
    hello?: WelcomeHello | null;
    now?: Date;
  },
): Promise<SetWelcomeConsentResult> {
  const now = input.now ?? nowDate();
  const [booking] = await db
    .select({ id: bookings.id, endsAt: trips.endsAt })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.id, input.bookingId),
        eq(bookings.shopId, input.shopId),
        ne(bookings.status, "cancelled"),
        eq(trips.shopId, input.shopId),
        liveTrip(),
      ),
    )
    .limit(1);
  if (!booking) return { ok: false, reason: "unknown_booking" };
  if (hasReturned(booking.endsAt, now)) {
    return { ok: false, reason: "trip_over" };
  }
  await db
    .update(bookings)
    .set({
      welcomeSharedAt: input.shared ? now : null,
      ...(!input.shared
        ? { welcomeHello: null }
        : input.hello !== undefined
          ? { welcomeHello: input.hello }
          : {}),
    })
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)));
  return { ok: true };
}

/**
 * **Which dive day with the shop one seat's departure is** (H-20261014-boat-count-milestones), for the
 * diver's own booked moment: the same count the crew read
 * (`diveDayCountsForSeats`), through this departure's own local day. Null for
 * a snorkeler's or a rider's seat, a cancelled one, or a seat that is not this
 * shop's.
 */
export async function diveDayCountForSeat(
  db: DbExecutor,
  shopId: string,
  bookingId: string,
): Promise<number | null> {
  const [seat] = await db
    .select({
      personId: bookings.personId,
      participantType: bookings.participantType,
      status: bookings.status,
      startsAt: trips.startsAt,
      timezone: shops.timezone,
    })
    .from(bookings)
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId)))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId), liveTrip()))
    .limit(1);
  if (seat?.participantType !== "diver" || seat.status === "cancelled") return null;
  const counts = await diveDayCountsForSeats(db, shopId, [{ bookingId, ...seat }]);
  return counts.get(bookingId) ?? null;
}
