import { and, asc, count, eq, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { effectiveMinimum, MINIMUM_SEATS_DECISION_HOURS_DEFAULT } from "@/lib/minimum-seats";
import type { AppDb } from "./client";
import { releaseUnclaimedGearReservationsForTrips } from "./gear";
import { bookings, people, shops, trips } from "./schema";
import { liveTrip } from "./trips-live";

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
        liveTrip(),
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
    // **Short, in SQL.** The below-minimum test has to run before `limit`, not
    // after it: filtering in TypeScript meant the cap counted departures that
    // had already filled, so a shop whose first 200 due departures all made
    // their numbers would have the 201st — a genuinely short one — silently
    // skipped, and `deferred` would report 0 while doing it. `least(...)` is
    // `effectiveMinimum`'s clamp said in SQL; the two are asserted against each
    // other in this file's tests.
    .having(sql`count(${bookings.id}) < least(${trips.minimumBookings}, ${trips.capacity})`)
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
    // Belt and braces: `having` above has already excluded these, so this is a
    // type narrowing rather than a second opinion.
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
 * **The whole rule rides on the `UPDATE` itself.** Every reason not to cancel
 * — the departure is no longer scheduled, its minimum has been cleared, a seat
 * sold that saves it — is a `WHERE` clause here rather than a check performed
 * before the write, so there is no window between deciding and doing. The
 * three races that closes are all real and all lose a shop something:
 *
 *  - **A seat sells.** The subquery counts active bookings inside the same
 *    statement, so a booking that commits first makes this a no-op rather than
 *    cancelling a departure that had just made its numbers.
 *  - **Staff cancel by hand.** `status = 'scheduled'` makes it a no-op.
 *  - **Staff reinstate.** Reinstating clears the minimum in the same statement
 *    that sets the status (`reinstateTripAction`), and `minimum_bookings is not
 *    null` here means a pass already in flight cannot cancel it straight back
 *    out from under them.
 *
 * This is deliberately *not* a `SELECT … FOR UPDATE` around a read-then-write:
 * that would need the booking path to take the same lock to mean anything, and
 * putting a new lock on `bookSpot` — the money- and capacity-critical
 * transaction — to protect a once-an-hour sweep is the wrong trade. One
 * conditional statement needs no lock at all.
 */
export async function cancelDeparturesBelowMinimum(
  db: AppDb,
  { now = nowDate(), limit = MINIMUM_SEATS_SWEEP_LIMIT }: { now?: Date; limit?: number } = {},
): Promise<MinimumSeatsSweepResult> {
  const due = await listDeparturesAwaitingMinimumDecision(db, { now, limit });
  const deferred = Math.max(0, due.length - limit);
  const considered = due.length - deferred;
  const cancelled: SweptDeparture[] = [];

  for (const departure of due.slice(0, limit)) {
    // One transaction per departure: the stamp and the gear release land
    // together, and the conditional `where` keeps its concurrency guarantee.
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(trips)
        // Stamped inline rather than routed through `setTripStatus`: the guard in
        // the `where` below (still scheduled, still short of its minimum) is what
        // makes this sweep safe to run concurrently, and a two-step read-then-set
        // through that seam would lose it. The stamp itself is the same act.
        .set({ status: "cancelled", cancelledAt: now })
        .where(
          and(
            eq(trips.id, departure.tripId),
            eq(trips.status, "scheduled"),
            isNotNull(trips.minimumBookings),
            sql`(
              select count(*) from ${bookings}
              where ${bookings.tripId} = ${trips.id} and ${bookings.status} <> 'cancelled'
            ) < least(${trips.minimumBookings}, ${trips.capacity})`,
          ),
        )
        .returning({ id: trips.id });
      if (updated) {
        // The cancelled departure keeps its bookings, so the booking cascade
        // never frees the gear reserved against it.
        await releaseUnclaimedGearReservationsForTrips(tx, {
          shopId: departure.shopId,
          tripIds: [updated.id],
        });
      }
      return updated;
    });
    if (row) cancelled.push(departure);
  }

  return { considered, cancelled, deferred };
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
 * Put a departure back on the board **and** spend its minimum, in one
 * statement.
 *
 * Reinstating *is* the shop saying "run it anyway", so the promise the minimum
 * encoded is over — without clearing it the next hourly pass would cancel the
 * trip again and the shop would be arguing with a cron job.
 *
 * The two writes are one `UPDATE` rather than a status flip followed by a
 * clear, because between those two statements the departure is `scheduled`
 * with its minimum still set and still short — which is precisely what the
 * sweep looks for. A pass landing in that gap would cancel the trip a staffer
 * had just reinstated, and the clear would then arrive to tidy up a departure
 * that was cancelled again.
 */
export async function reinstateTripClearingMinimum(db: AppDb, shopId: string, tripId: string) {
  const [trip] = await db
    .update(trips)
    .set({ status: "scheduled", minimumBookings: null, minimumDecisionHours: null })
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
    .returning();
  return trip ?? null;
}
