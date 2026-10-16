import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { departureUnderway } from "@/lib/day-blowout";
import { hasSailed } from "@/lib/trips";
import type { DbExecutor } from "./client";
import { onTheWaterByRollCall } from "./manifests";
import { bookings, rollCallEvents, tripStageEvents, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **Which seats on this departure the boat carried, or may be carrying**
 * (H-122): the seats no roster removal may cancel. A cancelled booking is
 * nobody to every roll-call reader (`./manifests.ts`), so removing one of these
 * would take a person on the water off the count, email them a cancellation
 * and maybe refund them. After the boat is home the answer stands: the seat
 * sailed, cancelling it would erase that from the record, and money goes back
 * through the order's refund instead.
 *
 * One rule for every place that asks it: `cancelBooking`'s transaction, under
 * the trip and seat locks, the party lead's cancel, the diver's own doors, and
 * the roster row that draws Remove. A seat is held when:
 *
 * - **The crew's roll call puts the person on the water**
 *   (`onTheWaterByRollCall`, consumed rather than restated): a standing
 *   `boarded` anywhere, or a standing after-dive `not_boarded`, which is the
 *   missing-diver row. Either after-dive word holds the seat whatever the dock
 *   said. A dock `boarded` alone holds only once the boat has **left**: from
 *   its scheduled time (`departureUnderway`, the blow-out's own rule), or once
 *   the crew's newest stage is past "Boarding". Before that it is the desk
 *   tidying a roster tied up at the dock.
 * - **The boat has sailed (`hasSailed`) and nobody spoke for the seat**: the
 *   glossary's **Sailed** counts a seat with no result as carried, because
 *   silence is an unfinished dock count (taps on an offline copy that has not
 *   synced) rather than a statement about a person. Only the dock's
 *   `not_boarded`, a dock tap undone with `cleared`, or the desk's no-show
 *   mark lets it go.
 *
 * `bookingIds` narrows the read to those seats; omitted, every live seat on the
 * departure. A departure that is not this shop's, or is deleted, has nobody here.
 */
export async function aboardAtSeaBookingIds(
  db: DbExecutor,
  input: { shopId: string; tripId: string; now: Date; bookingIds?: readonly string[] },
): Promise<Set<string>> {
  const { shopId, tripId, now, bookingIds } = input;
  const held = new Set<string>();
  if (bookingIds?.length === 0) return held;
  // One after the other, never side by side: this runs inside `cancelBooking`'s
  // transaction too. A boat still tied up with nobody counted ends after these
  // two reads, which is what the trip page pays on every render.
  const [trip] = await db
    .select({ startsAt: trips.startsAt })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
    .limit(1);
  if (!trip) return held;
  const { dock, spoken } = await rollCallSpoken(db, shopId, tripId, bookingIds);
  const pastItsTime = departureUnderway({ startsAt: trip.startsAt, rollCallStarted: false }, now);
  if (!pastItsTime && spoken.size === 0) return held;
  const sailed = hasSailed(trip.startsAt, now);
  const left = pastItsTime || (await crewSaidUnderway(db, shopId, tripId));

  const seats = await db
    .select({ id: bookings.id, status: bookings.status })
    .from(bookings)
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, tripId),
        ne(bookings.status, "cancelled"),
        bookingIds ? inArray(bookings.id, [...bookingIds]) : undefined,
      ),
    );
  for (const seat of seats) {
    const atDock = dock.get(seat.id) ?? null;
    // Nothing recorded for the seat and the boat still tied up: nobody is on
    // the water. (The crew table is asked only once the boat has left.)
    if (!spoken.has(seat.id) && !left) continue;
    const onTheWater = await onTheWaterByRollCall(db, shopId, tripId, seat.id);
    if (onTheWater !== null && (left || atDock !== "boarded")) {
      held.add(seat.id);
      continue;
    }
    if (sailed && atDock === null && seat.status !== "no_show") held.add(seat.id);
  }
  return held;
}

/**
 * The newest departure-checkpoint event per seat, `cleared` included (a dock
 * tap undone is the crew speaking for the seat, not silence), and every seat
 * with any roll-call event at all.
 */
async function rollCallSpoken(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  bookingIds: readonly string[] | undefined,
): Promise<{ dock: Map<string, "boarded" | "not_boarded" | "cleared">; spoken: Set<string> }> {
  const rows = await db
    .select({
      bookingId: rollCallEvents.bookingId,
      checkpoint: rollCallEvents.checkpoint,
      status: rollCallEvents.status,
    })
    .from(rollCallEvents)
    .where(
      and(
        eq(rollCallEvents.shopId, shopId),
        eq(rollCallEvents.tripId, tripId),
        bookingIds ? inArray(rollCallEvents.bookingId, [...bookingIds]) : undefined,
      ),
    )
    .orderBy(
      desc(rollCallEvents.occurredAt),
      desc(rollCallEvents.createdAt),
      desc(rollCallEvents.seq),
    );
  const dock = new Map<string, "boarded" | "not_boarded" | "cleared">();
  const spoken = new Set<string>();
  for (const row of rows) {
    spoken.add(row.bookingId);
    if (row.checkpoint === "departure" && !dock.has(row.bookingId)) {
      dock.set(row.bookingId, row.status);
    }
  }
  return { dock, spoken };
}

/** The newest stage the crew tapped is past "Boarding": the boat has left the dock. */
async function crewSaidUnderway(db: DbExecutor, shopId: string, tripId: string) {
  const [newest] = await db
    .select({ stage: tripStageEvents.stage })
    .from(tripStageEvents)
    .where(and(eq(tripStageEvents.shopId, shopId), eq(tripStageEvents.tripId, tripId)))
    .orderBy(desc(tripStageEvents.recordedAt), desc(tripStageEvents.seq))
    .limit(1);
  return newest !== undefined && newest.stage !== "boarding";
}

/**
 * **The diver's own doors ask the same question, only where it can change the
 * answer** (H-122): the ready page's Cancel, the reply keyword's candidates
 * and the party-cancel preview. Those doors already close at `hasSailed`, so
 * what is left is the late-departure hour from the scheduled time, and the
 * read is skipped before it, keeping a render that is nowhere near the dock
 * at its old cost. The one case that skip misses, a boat the crew take out
 * early with this diver counted aboard, is still refused by
 * `selfCancelBooking` itself; the door is merely drawn.
 */
export async function heldAtTheDoor(
  db: DbExecutor,
  input: {
    shopId: string;
    tripId: string;
    startsAt: Date;
    now: Date;
    bookingIds: readonly string[];
  },
): Promise<Set<string>> {
  const { startsAt, now } = input;
  if (input.bookingIds.length === 0) return new Set();
  if (hasSailed(startsAt, now) || !departureUnderway({ startsAt, rollCallStarted: false }, now)) {
    return new Set();
  }
  return aboardAtSeaBookingIds(db, input);
}
