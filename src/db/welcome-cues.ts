import { and, eq, inArray, isNotNull, lt, max, ne, notInArray, type SQL, sql } from "drizzle-orm";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { priorVisitStanding } from "@/lib/prior-visits";
import { hasReturned } from "@/lib/trips";
import type { AppDb, DbExecutor } from "./client";
import { diveDay } from "./dive-days";
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
  /**
   * Which boat with the shop this one is, for a diver seat: their earlier dive
   * days (`diveDay()`, the recap's own rule) and imported visits, plus this
   * one. Null on a snorkeler's or a rider's seat. Feeds the milestone (H-128).
   */
  boatCount: number | null;
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
      // The dive days among them, by the one rule every reader of a diver's
      // days calls (`src/db/dive-days.ts`), so the milestone counts what the
      // recap's ordinal counts.
      diveDays:
        sql<number>`count(*) filter (where ${bookings.participantType} = 'diver' and ${diveDay()})`
          .mapWith(Number)
          .as("dive_days"),
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
    participantType: string;
    lastDiveAt: Date | null;
    lastSeatAt: Date | null;
    personId: string;
    diveDays: number | null;
  },
  importedVisits: ReadonlyMap<string, number>,
): Pick<WelcomeCueInputs, "lastDivedAt" | "nonDiver" | "boatCount"> {
  const nonDiver = row.participantType !== "diver";
  return {
    lastDivedAt: (nonDiver ? row.lastSeatAt : row.lastDiveAt) ?? null,
    nonDiver,
    boatCount: nonDiver
      ? null
      : Number(row.diveDays ?? 0) + (importedVisits.get(row.personId) ?? 0) + 1,
  };
}

/**
 * Visits the shop's previous system remembers for each person, less the ones
 * it says did not happen: the same filter the recap's ordinal applies
 * (`priorVisitStanding`), so the two counts agree.
 */
async function importedVisitCounts(
  db: DbExecutor,
  shopId: string,
  personIds: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (personIds.length === 0) return counts;
  const rows = await db
    .select({ personId: priorVisits.personId, statusLabel: priorVisits.statusLabel })
    .from(priorVisits)
    .where(and(eq(priorVisits.shopId, shopId), inArray(priorVisits.personId, [...personIds])));
  for (const row of rows) {
    if (priorVisitStanding(row.statusLabel) === "did_not_happen") continue;
    counts.set(row.personId, (counts.get(row.personId) ?? 0) + 1);
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
      diveDays: prior.diveDays,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
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

  const imported = await importedVisitCounts(db, shopId, [
    ...new Set(rows.map((row) => row.personId)),
  ]);
  return new Map(
    rows.map((row) => [row.bookingId, { sharedAt: row.sharedAt, ...lastCounted(row, imported) }]),
  );
}

export type SharedWelcomeSeat = {
  tripId: string;
  bookingId: string;
  personName: string;
  sharedAt: Date;
} & Pick<WelcomeCueInputs, "lastDivedAt" | "nonDiver" | "boatCount">;

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
      diveDays: prior.diveDays,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
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

  const imported = await importedVisitCounts(db, shopId, [
    ...new Set(rows.map((row) => row.personId)),
  ]);
  for (const row of rows) {
    if (!row.sharedAt) continue;
    const seats = byTrip.get(row.tripId) ?? [];
    seats.push({
      tripId: row.tripId,
      bookingId: row.bookingId,
      personName: row.personName,
      sharedAt: row.sharedAt,
      ...lastCounted(row, imported),
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
  input: { shopId: string; bookingId: string; shared: boolean; now?: Date },
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
    .set({ welcomeSharedAt: input.shared ? now : null })
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)));
  return { ok: true };
}

/**
 * **Which boat with the shop one seat is** (H-128), for the diver's own booked
 * moment: the diver's dive days that started before this departure, by the one
 * rule (`diveDay()`), and the imported visits before its day, plus this one.
 * Null for a snorkeler's or a rider's seat, a cancelled one, or a seat that is
 * not this shop's. Counted against this departure's own start rather than
 * now, so a diver booking three boats ahead is told which number each will be.
 */
export async function boatCountForSeat(
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
    })
    .from(bookings)
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId)))
    .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId), liveTrip()))
    .limit(1);
  if (seat?.participantType !== "diver" || seat.status === "cancelled") return null;
  const [earlier] = await db
    .select({ days: sql<number>`count(*)`.mapWith(Number) })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.personId, seat.personId),
        eq(bookings.participantType, "diver"),
        ne(bookings.id, bookingId),
        lt(trips.startsAt, seat.startsAt),
        diveDay(),
      ),
    );
  const [shop] = await db
    .select({ timezone: shops.timezone })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  const tripDay = calendarDateInTimezone(seat.startsAt, shop?.timezone ?? "UTC");
  const visits = await db
    .select({ visitedOn: priorVisits.visitedOn, statusLabel: priorVisits.statusLabel })
    .from(priorVisits)
    .where(and(eq(priorVisits.shopId, shopId), eq(priorVisits.personId, seat.personId)));
  const imported = visits.filter(
    (visit) =>
      priorVisitStanding(visit.statusLabel) !== "did_not_happen" && visit.visitedOn < tripDay,
  ).length;
  return Number(earlier?.days ?? 0) + imported + 1;
}
