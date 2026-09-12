import { and, asc, countDistinct, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { shopDayBounds } from "@/lib/zoned";
import { type DbExecutor, queryAll } from "./client";
import { bookings, people, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **The season's scale, as three facts** — ADR 20260904-reef-all-the-way-down,
 * decision 2, Budget rule 3.
 *
 * The home says one fact of scale on the day it is true: the shop's hundredth
 * diver of the season boarding, or the season's first boat. Rule 3 bounds what
 * may be counted — divers or boats, never money, a comparison, a streak or a
 * rank — and this reader is the only place a count for it comes from.
 *
 * **The count is a read, never a cache.** Nothing is stored, nothing is
 * acknowledged, and the sentence ends by itself when the day does, which is
 * the same shape as the shop's first booking and the evening's all-home line.
 * The cost is bounded by the shop day: two counts and one page of today's
 * seats.
 */
export type SeasonScale = {
  /**
   * **Divers, not seats.** How many different people had already boarded this
   * season before today's calendar day began. A regular who dives every
   * Saturday is one diver, which is what "your 400th diver of the season"
   * means to the shop saying it.
   */
  diversBefore: number;
  /**
   * Today's seats in boarding order — the departure's clock, then the seat's
   * own, then the diver's name. The last key is what keeps the *named* diver
   * of a milestone the same on every render; see the `orderBy` below.
   */
  todaySeats: {
    personId: string;
    diverName: string;
    departureAt: Date;
    /** This person already boarded earlier this season, so they are not new. */
    seenEarlierThisSeason: boolean;
  }[];
  /** Today carries a departure and this season has had no earlier one. */
  firstBoatOfSeason: boolean;
};

/** Statuses a seat that is still standing can be in. */
const LIVE_BOOKING_STATUSES = ["booked", "checked_in"] as const;

export async function seasonScale(
  db: DbExecutor,
  shopId: string,
  timeZone: string,
  seasonStart: Date,
  now: Date,
): Promise<SeasonScale> {
  const { from, to } = shopDayBounds(now, timeZone);
  // A departure the shop deleted takes its seats out of the count with it, and
  // `liveTrip()` is what `pnpm check:repo`'s live-trips guard requires of every
  // read that joins through `trips`.
  const seatIsLive = and(
    eq(bookings.shopId, shopId),
    inArray(bookings.status, [...LIVE_BOOKING_STATUSES]),
    liveTrip(),
  );

  const [before, today, earliest] = await queryAll(db, [
    () =>
      db
        .select({ divers: countDistinct(bookings.personId) })
        .from(bookings)
        .innerJoin(trips, eq(bookings.tripId, trips.id))
        .where(and(seatIsLive, gte(trips.startsAt, seasonStart), lt(trips.startsAt, from))),
    () =>
      db
        .select({
          personId: bookings.personId,
          diverName: people.fullName,
          departureAt: trips.startsAt,
          // Answered per seat in SQL rather than by handing the domain layer a
          // set of every person who has dived this season: the shop day is
          // bounded, the season is not.
          seenEarlierThisSeason: sql<boolean>`exists (
            select 1 from ${bookings} as earlier
            join ${trips} as earlier_trip on earlier_trip.id = earlier.trip_id
            where earlier.person_id = ${bookings.personId}
              and earlier.shop_id = ${shopId}
              and earlier.status in ('booked', 'checked_in')
              and earlier_trip.deleted_at is null
              and earlier_trip.starts_at >= ${seasonStart}
              and earlier_trip.starts_at < ${from}
          )`,
        })
        .from(bookings)
        .innerJoin(trips, eq(bookings.tripId, trips.id))
        .innerJoin(people, eq(bookings.personId, people.id))
        .where(and(seatIsLive, gte(trips.startsAt, from), lt(trips.startsAt, to)))
        // **Total, and predictable — not merely total.** This order picks the
        // person the home *names*: `factOfScaleFor` walks these seats in
        // order and stops at the one that crosses the hundred, so whoever is
        // at that index is the diver a shop reads their own milestone about.
        //
        // The tie above the last key is not rare. `createBooking` stamps
        // `created_at` from the application clock (`nowDate()`, millisecond
        // resolution) rather than the column's `defaultNow()`, so a party
        // booked in one transaction can share an instant in production, and
        // under the frozen clock every seat a test or an e2e run writes shares
        // one. The tie-break used to be `asc(bookings.id)` — a
        // `defaultRandom()` uuid — so which of two divers on the same boat got
        // named was decided by a uuid, differently in every freshly seeded
        // database (issue #1753).
        //
        // `people.full_name` is already joined and selected here, so the
        // predictable key costs nothing; `asc(bookings.id)` stays last as the
        // only resort for two identically-named divers seated in one instant.
        .orderBy(
          asc(trips.startsAt),
          asc(bookings.createdAt),
          asc(people.fullName),
          asc(bookings.id),
        ),
    () =>
      db
        .select({ startsAt: trips.startsAt })
        .from(trips)
        .where(
          and(
            eq(trips.shopId, shopId),
            liveTrip(),
            gte(trips.startsAt, seasonStart),
            lt(trips.startsAt, to),
          ),
        )
        .orderBy(asc(trips.startsAt))
        .limit(1),
  ]);

  const first = earliest[0]?.startsAt ?? null;
  return {
    diversBefore: before[0]?.divers ?? 0,
    todaySeats: today,
    // Today has a boat, and it is the season's first: the earliest departure of
    // the season is today's own. A season with no departure at all has no
    // first boat to announce.
    firstBoatOfSeason: first != null && first.getTime() >= from.getTime(),
  };
}
