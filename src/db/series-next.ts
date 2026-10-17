import { and, asc, eq, gt, ne } from "drizzle-orm";
import type { AppDb } from "./client";
import { tripSeries, trips } from "./schema";
import { liveTrip, notRehearsal } from "./trips-live";

/**
 * **The next date of the same run**, for a diver whose seat on one occurrence
 * is gone (third UX review, item 16). A repeating departure ("every Saturday")
 * is one series of trips; the canceled page names the next one a stranger
 * could book from the public schedule: same shop, same series, still
 * scheduled, public, not yet started. Null for a one-off, or when the run has
 * no later date on the board.
 */
export async function nextPublicTripInSeries(
  db: AppDb,
  input: { shopId: string; tripId: string; now: Date },
): Promise<{ id: string; title: string; startsAt: Date } | null> {
  const [current] = await db
    .select({ seriesId: trips.seriesId })
    .from(trips)
    // diveday:allow-deleted-trips: only the series id of the seat's own departure, which may be the one taken off the board; the next date below is read live.
    .where(and(eq(trips.shopId, input.shopId), eq(trips.id, input.tripId)))
    .limit(1);
  if (!current?.seriesId) return null;
  const [next] = await db
    .select({ id: trips.id, title: trips.title, startsAt: trips.startsAt })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, input.shopId),
        eq(trips.seriesId, current.seriesId),
        ne(trips.id, input.tripId),
        eq(trips.status, "scheduled"),
        eq(trips.isPrivate, false),
        gt(trips.startsAt, input.now),
        liveTrip(),
        notRehearsal(),
      ),
    )
    .orderBy(asc(trips.startsAt))
    .limit(1);
  return next ?? null;
}

/** A repeating departure's cadence, and the run's next public date after it. */
export type PublicRun = {
  intervalWeeks: number;
  weekdayMask: number;
  /** The next public, scheduled date of the same run after this one, or null. */
  next: Date | null;
};

/**
 * **The run a departure belongs to, as a diver reads it** (fourth UX review,
 * item 35): "Runs every Saturday · next Sat, Oct 24" under the date of a
 * weekly boat, so a regular sees the habit. The cadence is the series row's
 * own (`recurrenceSummary` words it); the next date is the run's first public,
 * scheduled, live date after both this one and the clock, never this one or
 * an earlier one. Null for a one-off, or for another shop's departure.
 */
export async function publicRunOf(
  db: AppDb,
  input: { shopId: string; tripId: string; now: Date },
): Promise<PublicRun | null> {
  const [current] = await db
    .select({
      seriesId: trips.seriesId,
      startsAt: trips.startsAt,
      intervalWeeks: tripSeries.intervalWeeks,
      weekdayMask: tripSeries.weekdayMask,
    })
    .from(trips)
    .innerJoin(
      tripSeries,
      and(eq(tripSeries.id, trips.seriesId), eq(tripSeries.shopId, trips.shopId)),
    )
    .where(and(eq(trips.shopId, input.shopId), eq(trips.id, input.tripId), liveTrip()))
    .limit(1);
  if (!current?.seriesId) return null;
  const after = current.startsAt > input.now ? current.startsAt : input.now;
  const [next] = await db
    .select({ startsAt: trips.startsAt })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, input.shopId),
        eq(trips.seriesId, current.seriesId),
        ne(trips.id, input.tripId),
        eq(trips.status, "scheduled"),
        eq(trips.isPrivate, false),
        gt(trips.startsAt, after),
        liveTrip(),
        notRehearsal(),
      ),
    )
    .orderBy(asc(trips.startsAt))
    .limit(1);
  return {
    intervalWeeks: current.intervalWeeks,
    weekdayMask: current.weekdayMask,
    next: next?.startsAt ?? null,
  };
}
