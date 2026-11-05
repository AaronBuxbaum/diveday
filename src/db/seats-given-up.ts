import { and, count, eq, gte, inArray, isNotNull, isNull, lt, ne, sql } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { queryAll } from "./query-helpers";
import { activityEvents, bookings, trips } from "./schema";
import { liveTrip, notRehearsal } from "./trips-live";

/**
 * **The seats the month lost** (loop 5, row 12; glossary "Late cancel"): the
 * divers who did not come, and the divers who gave their seat up inside the
 * departure's own free-cancellation window.
 *
 * - A **no-show** is a released seat the desk marked "Not here" on a departure
 *   in the window. A diver the desk turned away is a safety call, not a
 *   no-show, and stays out (`turned_away_at`).
 * - A **late cancel** is a diver's own cancel from their trip link (the trail's
 *   `seat_self_*`, `seat_holder_*` and `party_seat_self_*` lines) written less
 *   than the departure's `cancellation_window_hours` before it left. A
 *   departure that states no window has no "late": the shop never promised
 *   one, so nothing is counted against the diver.
 *
 * Departures count by their own start, as every other Reports figure does;
 * rehearsals and deleted departures stay out. A figure the owner reads, never
 * a gate or a fee.
 */
export type SeatsGivenUp = { noShows: number; lateCancels: number };

const DIVER_CANCEL_CODES = [
  "seat_self_cancelled",
  "seat_self_refunded",
  "seat_holder_cancelled",
  "seat_holder_refunded",
  "party_seat_self_cancelled",
  "party_seat_self_refunded",
] as const;

export async function seatsGivenUpInWindow(
  db: DbExecutor,
  shopId: string,
  window: { startUtc: Date; endUtc: Date },
): Promise<SeatsGivenUp> {
  const inWindow = and(
    eq(trips.shopId, shopId),
    ne(trips.status, "cancelled"),
    gte(trips.startsAt, window.startUtc),
    lt(trips.startsAt, window.endUtc),
    notRehearsal(),
  );
  const [noShowRows, lateRows] = await queryAll(db, [
    () =>
      db
        .select({ seats: count(bookings.id) })
        .from(bookings)
        .innerJoin(trips, eq(trips.id, bookings.tripId))
        .where(
          and(
            eq(bookings.shopId, shopId),
            eq(bookings.status, "no_show"),
            isNull(bookings.turnedAwayAt),
            liveTrip(),
            inWindow,
          ),
        ),
    () =>
      db
        .select({ seats: count(activityEvents.id) })
        .from(activityEvents)
        .innerJoin(trips, eq(trips.id, activityEvents.tripId))
        .where(
          and(
            eq(activityEvents.shopId, shopId),
            inArray(activityEvents.code, [...DIVER_CANCEL_CODES]),
            isNotNull(trips.cancellationWindowHours),
            sql`${activityEvents.occurredAt} > ${trips.startsAt} - make_interval(hours => ${trips.cancellationWindowHours})`,
            liveTrip(),
            inWindow,
          ),
        ),
  ]);
  return {
    noShows: Number(noShowRows[0]?.seats ?? 0),
    lateCancels: Number(lateRows[0]?.seats ?? 0),
  };
}
