import { and, asc, count, eq, gte, inArray, lt } from "drizzle-orm";
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
  /** Seats this season that boarded before today's calendar day began. */
  seatsBefore: number;
  /** Today's seats in boarding order — the departure's clock, then the booking's. */
  todaySeats: { diverName: string; departureAt: Date }[];
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
        .select({ seats: count() })
        .from(bookings)
        .innerJoin(trips, eq(bookings.tripId, trips.id))
        .where(and(seatIsLive, gte(trips.startsAt, seasonStart), lt(trips.startsAt, from))),
    () =>
      db
        .select({ diverName: people.fullName, departureAt: trips.startsAt })
        .from(bookings)
        .innerJoin(trips, eq(bookings.tripId, trips.id))
        .innerJoin(people, eq(bookings.personId, people.id))
        .where(and(seatIsLive, gte(trips.startsAt, from), lt(trips.startsAt, to)))
        // Total rather than usually-stable: the hundredth diver must be the
        // same diver on every render of the same day.
        .orderBy(asc(trips.startsAt), asc(bookings.createdAt), asc(bookings.id)),
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
    seatsBefore: before[0]?.seats ?? 0,
    todaySeats: today,
    // Today has a boat, and it is the season's first: the earliest departure of
    // the season is today's own. A season with no departure at all has no
    // first boat to announce.
    firstBoatOfSeason: first != null && first.getTime() >= from.getTime(),
  };
}
