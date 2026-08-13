import { and, asc, count, eq, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { effectiveMinimum, MINIMUM_SEATS_DECISION_HOURS_DEFAULT } from "@/lib/minimum-seats";
import type { AppDb } from "./client";
import { bookings, people, shops, trips } from "./schema";

/**
 * The minimum-head-count sweep: cancel every departure whose decision moment
 * has passed while it is still short (src/lib/minimum-seats.ts).
 *
 * One pass, cross-shop, run from `src/app/api/cron/minimum-seats/`. It is the
 * half of the feature a shop is actually buying — a minimum nobody enforces is
 * the sticky note the shop already had — and it is deliberately the *only*
 * thing that cancels for a minimum. Staff keep their ordinary cancel button,
 * and reinstating a swept departure is the same ordinary reinstate: nothing
 * here re-cancels a trip a human has put back, because putting it back clears
 * the minimum (see `reinstateTripAction`).
 */

/**
 * How many departures one pass will cancel. Far above any real day — a shop
 * running a hundred short departures into one deadline has a scheduling
 * problem, not a sweep problem — and low enough that a runaway can never turn
 * one cron tick into an unbounded write. A pass that hits it says so in its
 * result rather than reporting a clean run (same rule as the series roll's
 * `deferred`).
 */
export const MINIMUM_SEATS_SWEEP_LIMIT = 200;

export type SweptDeparture = {
  tripId: string;
  shopId: string;
  shopName: string;
  shopSlug: string;
  shopTimezone: string;
  shopDefaultLocale: string | null;
  title: string;
  startsAt: Date;
  minimum: number;
  booked: number;
};

export type MinimumSeatsSweepResult = {
  /** Departures the pass considered — short, past their moment, still scheduled. */
  considered: number;
  cancelled: SweptDeparture[];
  /** Left for the next pass because this one hit `MINIMUM_SEATS_SWEEP_LIMIT`. */
  deferred: number;
};

/**
 * Every scheduled departure that names a minimum, has not left, and whose
 * decision moment is at or behind `now` — with its live booked count.
 *
 * The deadline is computed in SQL rather than read from a stored column so
 * moving a departure moves its deadline with it: the window is "hours before
 * this trip leaves", and a trip slid two days later has genuinely not reached
 * its moment yet. `coalesce` supplies the default window, matching
 * `minimumSeatsDecisionAt` — the two definitions are asserted against each
 * other in this file's tests rather than merely written to look alike.
 */
export async function listDeparturesAwaitingMinimumDecision(
  db: AppDb,
  { now = nowDate(), limit = MINIMUM_SEATS_SWEEP_LIMIT }: { now?: Date; limit?: number } = {},
): Promise<SweptDeparture[]> {
  const rows = await db
    .select({
      tripId: trips.id,
      shopId: trips.shopId,
      shopName: shops.name,
      shopSlug: shops.slug,
      shopTimezone: shops.timezone,
      shopDefaultLocale: shops.defaultLocale,
      title: trips.title,
      startsAt: trips.startsAt,
      capacity: trips.capacity,
      minimumBookings: trips.minimumBookings,
      minimumDecisionHours: trips.minimumDecisionHours,
      booked: count(bookings.id),
    })
    .from(trips)
    .innerJoin(shops, eq(shops.id, trips.shopId))
    .leftJoin(bookings, and(eq(bookings.tripId, trips.id), ne(bookings.status, "cancelled")))
    .where(
      and(
        eq(trips.status, "scheduled"),
        isNotNull(trips.minimumBookings),
        // Not yet departed. A trip that already left is not a decision anybody
        // can still make, and cancelling one would rewrite a day that happened.
        sql`${trips.startsAt} > ${now}`,
        lte(
          sql`${trips.startsAt} - make_interval(hours => coalesce(${trips.minimumDecisionHours}, ${MINIMUM_SEATS_DECISION_HOURS_DEFAULT}))`,
          now,
        ),
      ),
    )
    .groupBy(trips.id, shops.id)
    // Oldest deadline first, so a capped pass always clears the departures
    // whose divers have been waiting longest for an answer.
    .orderBy(asc(trips.startsAt))
    .limit(limit + 1);

  return rows.flatMap((row) => {
    const minimum = effectiveMinimum(
      {
        minimumBookings: row.minimumBookings,
        minimumDecisionHours: row.minimumDecisionHours,
      },
      row.capacity,
    );
    if (minimum === null || row.booked >= minimum) return [];
    return [
      {
        tripId: row.tripId,
        shopId: row.shopId,
        shopName: row.shopName,
        shopSlug: row.shopSlug,
        shopTimezone: row.shopTimezone,
        shopDefaultLocale: row.shopDefaultLocale,
        title: row.title,
        startsAt: row.startsAt,
        minimum,
        booked: row.booked,
      },
    ];
  });
}

/**
 * Cancel them. Returns what was cancelled so the caller can tell the divers —
 * the notification is the caller's job, not this function's, for the same
 * reason `bookSpot` does not send the confirmation: a write that also sends
 * mail cannot be tested, retried, or reasoned about as one thing.
 *
 * Each cancellation is its own conditional update rather than one bulk
 * statement, and the condition re-states `status = 'scheduled'`: between the
 * read above and this write, a staffer may have cancelled the departure by
 * hand or a diver may have booked the seat that saves it. The status guard
 * makes the first case a no-op; the booked count is deliberately *not*
 * re-checked, because a seat sold in that window is a race the shop should win
 * — so the pass re-reads the count immediately before writing.
 */
export async function cancelDeparturesBelowMinimum(
  db: AppDb,
  { now = nowDate(), limit = MINIMUM_SEATS_SWEEP_LIMIT }: { now?: Date; limit?: number } = {},
): Promise<MinimumSeatsSweepResult> {
  const due = await listDeparturesAwaitingMinimumDecision(db, { now, limit });
  const deferred = Math.max(0, due.length - limit);
  const cancelled: SweptDeparture[] = [];

  for (const departure of due.slice(0, limit)) {
    const [{ booked }] = await db
      .select({ booked: count(bookings.id) })
      .from(bookings)
      .where(and(eq(bookings.tripId, departure.tripId), ne(bookings.status, "cancelled")));
    if (booked >= departure.minimum) continue;

    const [row] = await db
      .update(trips)
      .set({ status: "cancelled" })
      .where(and(eq(trips.id, departure.tripId), eq(trips.status, "scheduled")))
      .returning({ id: trips.id });
    if (row) cancelled.push({ ...departure, booked });
  }

  return { considered: due.length - deferred, cancelled, deferred };
}

/**
 * Who to tell, for a departure the sweep just cancelled.
 *
 * Read *after* the cancellation, deliberately: flipping the trip's status
 * leaves the bookings alone (a cancelled departure still knows who was on it,
 * which is what makes reinstating one possible), so the recipient list is the
 * same either way — and reading it afterwards means a trip that failed to
 * cancel never gets mail saying it did.
 */
export async function listMinimumNotMetRecipients(db: AppDb, shopId: string, tripId: string) {
  return db
    .select({
      bookingId: bookings.id,
      email: people.email,
      fullName: people.fullName,
      personLocale: people.locale,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, tripId),
        ne(bookings.status, "cancelled"),
        isNull(people.deletedAt),
      ),
    );
}

/**
 * Clear a departure's minimum. Called when staff reinstate a trip the sweep
 * took off the board: without this the next pass would cancel it again inside
 * the hour, and the shop would be arguing with a cron job. Reinstating *is* the
 * shop saying "run it anyway", so the promise the minimum encoded is spent.
 */
export async function clearMinimumSeats(db: AppDb, shopId: string, tripId: string) {
  await db
    .update(trips)
    .set({ minimumBookings: null, minimumDecisionHours: null })
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)));
}
