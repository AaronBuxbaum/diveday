import { and, eq, ne, or, type SQL, sql } from "drizzle-orm";
import { bookings, executedDives, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **"Did this person dive with us that day"**, asked of one booking on its
 * departure: the one rule every reader of a diver's dive days calls (issue
 * #1694, ruled H-84). Each predicate reads `bookings` and `trips` and expects
 * the query to have joined them; none joins anything itself, so a reader never
 * gains a row per logged dive.
 *
 * The readers: the recap's dive-day count (`getRecapPageData`,
 * `src/db/recap.ts`, which feeds `visitMilestone`), the counter's name-match
 * prompt (`SimilarDiver.lastDiveDayAt`, `src/db/divers.ts`), and the fly-safe
 * multi-day advisory (`peopleWhoDivedBefore`, `src/db/executed-dives.ts`). The
 * first two call {@link diveDay} whole. The fly-safe reader calls the two
 * halves apart, because it alone lets a standing roll-call result outrank the
 * desk's words (issue #1836): being wrong there hands a two-day diver the
 * single-day flying wait.
 */

/**
 * **The part nothing outranks.** A `no_show` is never a dive day, with no
 * escape, the roll call included (issue #1558, settled by a
 * `dive-domain-expert` review on 2026-09-11): `markBookingNoShow`
 * (`src/db/no-show.ts`) is its only writer, one staffer's deliberate tap that
 * check-in can only precede, so any sighting is the older statement. A boarding
 * needs no escape either: both roll-call writers put a `no_show` seat back to
 * `booked` when they record one. A deleted departure is a row staff say should
 * not exist, not a day to count.
 */
export function seatCanBeDiveDay(): SQL {
  return and(ne(bookings.status, "no_show"), liveTrip()) as SQL;
}

/**
 * **What the desk's status words say.** A cancelled booking is no dive day:
 * the boat diving says nothing about whether this seat was on it. A departure
 * marked anything but `scheduled` is no dive day **unless the crew logged a
 * live dive on it** (H-84): a logged dive is affirmative evidence that people
 * went in the water, and beats a status changed afterwards for a refund, a
 * blow-out declared after the first tank, or a re-papered charter.
 *
 * An `exists` rather than a join, so a departure with three logged dives is
 * still one row per booking.
 */
export function deskCountsDiveDay(): SQL {
  return and(
    ne(bookings.status, "cancelled"),
    or(
      eq(trips.status, "scheduled"),
      sql`exists (select 1 from ${executedDives} where ${executedDives.tripId} = ${trips.id} and ${executedDives.shopId} = ${trips.shopId} and ${executedDives.deletedAt} is null)`,
    ),
  ) as SQL;
}

/** The whole rule: a booking whose day counts as a dive day. */
export function diveDay(): SQL {
  return and(seatCanBeDiveDay(), deskCountsDiveDay()) as SQL;
}
