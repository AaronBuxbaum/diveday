import { and, eq, gte, inArray, isNull } from "drizzle-orm";
import type { AppDb } from "../../db/client";
import { recordRollCall } from "../../db/manifests";
import { bookings, people, personRoles, trips } from "../../db/schema/index";
import { STAFF_ROLES } from "../../lib/authz";

/**
 * **A departure the Move panel refuses outright** (issue #1786) — the
 * `already_sailed` half of `MovePreflight["blocked"]`, which is the one state
 * of that preview with no baseline.
 *
 * `blockedReason` (`src/features/move-preflight/rules.ts`) keys on **roll-call evidence**,
 * not on a window that has passed: a scheduled departure the crew have counted
 * heads against is one `moveTrip` refuses. So this records one boarding through
 * `recordRollCall` — the product's own door — rather than writing
 * `trips.starts_at` into the past, which would photograph a row the product
 * could not have made and would take the departure off the board the panel is
 * opened from.
 *
 * Not seeded into blue-mantis, for the reason the whole route exists: a demo
 * board with a departure nobody can move is a worse demo, and roll-call
 * evidence moves Today's open-count queue, which several unrelated captures
 * read.
 *
 * **The soonest departure that is not one of the two already photographed,
 * and whose seat the boarding gate will actually clear.** The captures already
 * in this file drive the wreck charter and the Christ of the Abyss reef day;
 * marking either of those would change what they photograph. The soonest of
 * the rest is the one certain to be on the board's first keyset page, which is
 * the page the capture opens. Returns the title as well as the id, because the
 * panel is reached through the board row's accessible name and a capture
 * cannot spell a uuid.
 */
export async function countHeadsOnADepartureNobodyWillMove(
  db: AppDb,
  shopId: string,
  now: Date,
): Promise<{ tripId: string; title: string } | null> {
  // **A staff person, not the route's shared `actor`**, for the reason
  // `boardADiverThenBlockThem` states below: `recordRollCall` answers
  // `staff_not_found` for anyone else, and the shared actor is whichever row
  // came first.
  const [crew] = await db
    .select({ id: people.id })
    .from(people) // diveday:allow-deleted-people: an e2e seed finds the people it just seeded
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shopId), inArray(personRoles.role, [...STAFF_ROLES])))
    .limit(1);
  if (!crew) return null;

  const seats = await db
    .select({ bookingId: bookings.id, tripId: trips.id, title: trips.title })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.status, "booked"),
        eq(trips.status, "scheduled"),
        isNull(trips.deletedAt),
        // Still ahead: the board's stream is a keyset page of *upcoming*
        // departures, so a past one would be marked and then not be there to
        // open the panel from.
        gte(trips.startsAt, now),
      ),
    )
    .orderBy(trips.startsAt);

  for (const seat of seats) {
    // Anything but the two the other captures drive.
    if (
      seat.title.startsWith("Wreck Trip — Spiegel Grove") ||
      seat.title.startsWith("Two-Tank Reef — Christ of the Abyss")
    ) {
      continue;
    }
    const recorded = await recordRollCall(db, {
      shopId,
      tripId: seat.tripId,
      bookingId: seat.bookingId,
      recordedByPersonId: crew.id,
      status: "boarded",
    });
    // `not_ready` is the boarding gate doing its job — that diver is blocked
    // and the app refuses to count them. Try the next seat, which is why this
    // reads every candidate rather than only the soonest.
    if (!recorded.ok) continue;
    return { tripId: seat.tripId, title: seat.title };
  }
  return null;
}
