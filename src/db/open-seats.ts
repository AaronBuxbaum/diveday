import { and, desc, eq, gte, inArray, lt, max, ne, notInArray, sql } from "drizzle-orm";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { type OpenSeatsDebrief, openSeatsDebrief } from "@/lib/open-seats";
import type { AppDb } from "./client";
import { bookings, trips } from "./schema";
import { tripIdsNeverSentLastMinuteDeal } from "./trip-promos";
import { liveTrip } from "./trips-live";

/**
 * **Why a sailed departure's seats went unsold** — the db half of the
 * open-seats debrief (issue #1207, D47; `src/lib/open-seats.ts` is the pure
 * half and its rules).
 *
 * It lives on the departure's Details tab, not on the shop home's day spine
 * (UX review 2026-10-10, item 31): a post-mortem about selling is a reading
 * for whoever plans the next run of that trip, and on Today it sat between the
 * desk and the work the evening still wants.
 */

/**
 * How far back the evening looks for a departure to compare a short boat with
 * (issue #1207, D47). A season, roughly — far enough that a weekly charter has
 * run a dozen times, near enough that the comparison is about this year's
 * market rather than last year's. One constant, deliberately: it is the
 * implementing session's call rather than the issue's, and it is meant to be
 * easy to move.
 */
const COMPARABLE_HORIZON_MS = 90 * 24 * HOUR_MS;

/**
 * **The comparable departure** — the most recent same-title trip that filled,
 * per departure asked about.
 *
 * One query, one `where`, one `having`: the capacity comparison rides inside
 * the same grouped read that produces the row, so the count and the row can
 * never disagree about which departures qualify. Splitting them is the classic
 * bug on exactly this kind of view, and #1207's triage names it.
 *
 * **It carries no crew, no rank and no rate**, and it must not grow any. D47's
 * boundary is that the evening states facts about seats, never a scoreboard
 * about people, and the surest way to keep it one is to have nothing here that
 * could become one.
 */
export async function comparableDepartures(
  db: AppDb,
  shopId: string,
  departures: readonly { id: string; title: string; startsAt: Date; priceCents: number | null }[],
): Promise<Map<string, { title: string; startsAt: Date; samePrice: boolean } | null>> {
  const answer = new Map<string, { title: string; startsAt: Date; samePrice: boolean } | null>(
    departures.map((trip) => [trip.id, null]),
  );
  if (departures.length === 0) return answer;
  const startTimes = departures.map((trip) => trip.startsAt.getTime());
  const horizon = new Date(Math.min(...startTimes) - COMPARABLE_HORIZON_MS);
  const latest = new Date(Math.max(...startTimes));

  const candidates = await db
    .select({
      title: trips.title,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
      priceCents: trips.priceCents,
    })
    .from(trips)
    .leftJoin(
      bookings,
      and(
        eq(bookings.tripId, trips.id),
        eq(bookings.shopId, shopId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        inArray(trips.title, [...new Set(departures.map((trip) => trip.title))]),
        lt(trips.endsAt, latest),
        gte(trips.endsAt, horizon),
        notInArray(
          trips.id,
          departures.map((trip) => trip.id),
        ),
      ),
    )
    .groupBy(trips.id)
    .having(sql`count(${bookings.id}) >= ${trips.capacity}`)
    .orderBy(desc(trips.endsAt));

  for (const trip of departures) {
    const match = candidates.find(
      (candidate) =>
        candidate.title === trip.title && candidate.endsAt.getTime() < trip.startsAt.getTime(),
    );
    answer.set(
      trip.id,
      match
        ? {
            title: match.title,
            startsAt: match.startsAt,
            // Both null reads as the same price, which is honest: two
            // departures that both say "ask the shop" are priced alike as far
            // as anything on the board is concerned.
            samePrice: match.priceCents === trip.priceCents,
          }
        : null,
    );
  }
  return answer;
}

/**
 * The debrief for one departure, or null when there is nothing true to say
 * (it filled, it has not sailed, or nothing is known). Shop-scoped like every
 * read here: a trip id from another shop answers null.
 */
export async function getTripOpenSeatsDebrief(
  db: AppDb,
  shopId: string,
  tripId: string,
  timeZone: string,
  now: Date = nowDate(),
): Promise<OpenSeatsDebrief | null> {
  const [trip] = await db
    .select({
      id: trips.id,
      title: trips.title,
      startsAt: trips.startsAt,
      capacity: trips.capacity,
      priceCents: trips.priceCents,
    })
    .from(trips)
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, shopId),
        eq(trips.id, tripId),
        eq(trips.status, "scheduled"),
      ),
    )
    .limit(1);
  if (!trip) return null;
  const [[seats], neverSentDeal, comparables] = await Promise.all([
    // **D47's first clause** — when the last seat sold, beside how many did.
    db
      .select({ booked: sql<number>`count(*)::int`, lastBookingAt: max(bookings.createdAt) })
      .from(bookings)
      .where(
        and(
          eq(bookings.shopId, shopId),
          eq(bookings.tripId, trip.id),
          ne(bookings.status, "cancelled"),
        ),
      ),
    // **D47's second** — the deal that never went out, answered by the module
    // that owns last-minute deals rather than by a second query here.
    tripIdsNeverSentLastMinuteDeal(db, shopId, [trip.id]),
    comparableDepartures(db, shopId, [trip]),
  ]);
  return openSeatsDebrief(
    {
      capacity: trip.capacity,
      booked: seats?.booked ?? 0,
      startsAt: trip.startsAt,
      timeZone,
      lastBookingAt: seats?.lastBookingAt ?? null,
      // The reader answers "never sent", so a trip absent from it sent one.
      dealSent: !neverSentDeal.has(trip.id),
      comparable: comparables.get(trip.id) ?? null,
    },
    now,
  );
}
