import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { departureUnderway } from "@/lib/day-blowout";
import { hasSailed } from "@/lib/trips";
import type { AppDb, DbExecutor } from "./client";
import { onTheWaterByRollCall } from "./manifests";
import {
  bookings,
  rollCallCrewEvents,
  rollCallEvents,
  tripAssignments,
  tripStageEvents,
  trips,
} from "./schema";
import { lockTripRevisionNotificationFence } from "./trip-revision-notification-fence";
import { liveTrip } from "./trips-live";
import { setTripStatus } from "./trips-record";

/**
 * Why a seat is held (H-20261015-aboard-diver-removal-at). `on_the_water`: the crew's roll call puts the
 * person on the boat or in the water. `uncounted`: the departure sailed and
 * nobody at the dock spoke for the seat, so the boat may have carried them;
 * the dock's "not boarded" lets it go.
 */
export type AboardHold = "on_the_water" | "uncounted";

/**
 * **Which seats on this departure the boat carried, or may be carrying**
 * (H-20261015-aboard-diver-removal-at), and why: the seats no roster removal may cancel. A cancelled booking
 * is nobody to every roll-call reader (`./manifests.ts`), so removing one of
 * these would take a person on the water off the count, email them a
 * cancellation and maybe refund them. After the boat is home the answer
 * stands: the seat sailed, cancelling it would erase that from the record, and
 * money goes back through the order's refund instead.
 *
 * One rule for every place that asks it: `cancelBooking`'s transaction, under
 * the trip and seat locks, the party lead's cancel, the diver's own doors, and
 * the roster row that draws Remove. Nothing is held until the boat has
 * **left** (`boatHasLeft`): its scheduled time, a stage past "Boarding", or
 * any after-dive roll-call event, diver or crew, since no after-dive
 * checkpoint is taken at the dock. Before that it is the desk tidying a roster
 * tied up at the dock. Once it has left, a seat is held when:
 *
 * - **The crew's roll call puts the person on the water**
 *   (`onTheWaterByRollCall`, consumed rather than restated): a standing
 *   `boarded` anywhere, or a standing after-dive `not_boarded`, which is the
 *   missing-diver row, on the diver list or, for a staffer, the crew list.
 * - **The boat has sailed (`hasSailed`) and nobody spoke for the seat at the
 *   dock**: the glossary's **Sailed** counts a seat with no result as carried,
 *   because silence is an unfinished dock count (taps on an offline copy that
 *   has not synced) rather than a statement about a person. A dock tap undone
 *   with `cleared` is silence again. Only the dock's `not_boarded` (for a
 *   staffer on this crew, the crew list's) or the desk's no-show mark lets it go.
 *
 * `bookingIds` narrows the read to those seats; omitted, every live seat on the
 * departure. A departure that is not this shop's, or is deleted, has nobody here.
 */
export async function aboardAtSeaBookingIds(
  db: DbExecutor,
  input: { shopId: string; tripId: string; now: Date; bookingIds?: readonly string[] },
): Promise<Map<string, AboardHold>> {
  const { shopId, tripId, now, bookingIds } = input;
  const held = new Map<string, AboardHold>();
  if (bookingIds?.length === 0) return held;
  // One after the other, never side by side: this runs inside `cancelBooking`'s
  // transaction too. A boat still tied up ends after these two reads.
  const [trip] = await db
    .select({ startsAt: trips.startsAt })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
    .limit(1);
  if (!trip) return held;
  if (!(await boatHasLeft(db, { shopId, tripId, startsAt: trip.startsAt, now }))) return held;
  const sailed = hasSailed(trip.startsAt, now);
  const dock = await dockWordBySeat(db, shopId, tripId, bookingIds);

  const seats = await db
    .select({ id: bookings.id, status: bookings.status, personId: bookings.personId })
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
    if ((await onTheWaterByRollCall(db, shopId, tripId, seat.id)) !== null) {
      held.set(seat.id, "on_the_water");
      continue;
    }
    if (!sailed || seat.status === "no_show") continue;
    if (dock.get(seat.id) === "not_boarded") continue;
    // The diver list is silent: a staffer on this crew may have been marked
    // ashore on the crew list instead.
    if (await crewMarkedAshore(db, shopId, tripId, seat.personId)) continue;
    held.set(seat.id, "uncounted");
  }
  return held;
}

/**
 * **The boat has left the dock**: its scheduled time has come
 * (`departureUnderway`, the blow-out's clock), or the crew took it out
 * ({@link crewTookTheBoatOut}).
 */
export async function boatHasLeft(
  db: DbExecutor,
  input: { shopId: string; tripId: string; startsAt: Date; now: Date },
): Promise<boolean> {
  const { shopId, tripId, startsAt, now } = input;
  if (departureUnderway({ startsAt, rollCallStarted: false }, now)) return true;
  return crewTookTheBoatOut(db, shopId, tripId);
}

/**
 * **The crew's own word that the boat is off the dock**, whatever the clock
 * says: their newest stage is past "Boarding", or anybody, diver or crew, has
 * an after-dive roll-call event, even one since undone. No after-dive
 * checkpoint is taken at the dock, so a boat taken out early is caught with no
 * stage tapped.
 */
export async function crewTookTheBoatOut(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<boolean> {
  const [row] = await db
    .select({
      afterDive:
        sql<boolean>`(exists (select 1 from ${rollCallEvents} where ${rollCallEvents.shopId} = ${shopId} and ${rollCallEvents.tripId} = ${tripId} and ${rollCallEvents.checkpoint} <> 'departure') or exists (select 1 from ${rollCallCrewEvents} where ${rollCallCrewEvents.shopId} = ${shopId} and ${rollCallCrewEvents.tripId} = ${tripId} and ${rollCallCrewEvents.checkpoint} <> 'departure'))`.mapWith(
          Boolean,
        ),
      stage: sql<
        string | null
      >`(select ${tripStageEvents.stage} from ${tripStageEvents} where ${tripStageEvents.shopId} = ${shopId} and ${tripStageEvents.tripId} = ${tripId} order by ${tripStageEvents.recordedAt} desc, ${tripStageEvents.seq} desc limit 1)`,
    })
    .from(trips)
    .where(and(eq(trips.id, tripId), liveTrip()));
  if (!row) return false;
  return row.afterDive || (row.stage !== null && row.stage !== "boarding");
}

/**
 * **Whether anybody on this departure may be on the water** (H-20261015-aboard-diver-removal-at), for the
 * whole-trip Cancel: the crew took the boat out, a seat is held
 * ({@link aboardAtSeaBookingIds}), or a crew member is aboard by the same
 * rule: boarded at the dock once the boat has left, or never marked ashore once
 * it has sailed (the glossary's **crew sailing**). A boat still tied up, its
 * dock count taken or not, is nobody at sea, so a weather scrub there goes.
 */
export async function departureMayBeAtSea(
  db: DbExecutor,
  input: { shopId: string; tripId: string; startsAt: Date; now: Date },
): Promise<boolean> {
  const { shopId, tripId, startsAt, now } = input;
  if (await crewTookTheBoatOut(db, shopId, tripId)) return true;
  if (!departureUnderway({ startsAt, rollCallStarted: false }, now)) return false;
  if ((await aboardAtSeaBookingIds(db, { shopId, tripId, now })).size > 0) return true;
  const crewDock = await crewDockWords(db, shopId, tripId);
  const sailed = hasSailed(startsAt, now);
  for (const word of crewDock.values()) {
    if (word === "boarded" || (sailed && word !== "not_boarded")) return true;
  }
  return false;
}

/**
 * Each assigned crew member's newest dock word, or `null` for none: the crew
 * half of the departure's count. Somebody taken off the crew is not on it.
 */
async function crewDockWords(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<Map<string, "boarded" | "not_boarded" | "cleared" | null>> {
  const crew = await db
    .select({ personId: tripAssignments.personId })
    .from(tripAssignments)
    .where(eq(tripAssignments.tripId, tripId));
  const words = new Map<string, "boarded" | "not_boarded" | "cleared" | null>(
    crew.map(({ personId }) => [personId, null]),
  );
  if (words.size === 0) return words;
  const rows = await db
    .select({ personId: rollCallCrewEvents.personId, status: rollCallCrewEvents.status })
    .from(rollCallCrewEvents)
    .where(
      and(
        eq(rollCallCrewEvents.shopId, shopId),
        eq(rollCallCrewEvents.tripId, tripId),
        eq(rollCallCrewEvents.checkpoint, "departure"),
      ),
    )
    .orderBy(
      desc(rollCallCrewEvents.occurredAt),
      desc(rollCallCrewEvents.createdAt),
      desc(rollCallCrewEvents.seq),
    );
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.personId) || !words.has(row.personId)) continue;
    seen.add(row.personId);
    words.set(row.personId, row.status);
  }
  return words;
}

/**
 * **One departure called off from its own page**, refused while anybody may
 * be on the water ({@link departureMayBeAtSea}). Cancelling then would hand
 * roll call a cancelled trip, and Today's roll-call gaps and the shore alert
 * read scheduled departures only, so a missing diver would vanish from both.
 * Asked under the trip's row lock, the one the blow-out and the roll call take.
 */
export async function cancelDeparture(
  db: AppDb,
  shopId: string,
  tripId: string,
  now: Date = nowDate(),
  options: { actorPersonId?: string | null } = {},
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "trip_departed" }> {
  return db.transaction(async (tx) => {
    // Match reschedule dispatch ordering: fence before taking the trip row.
    await lockTripRevisionNotificationFence(tx, shopId, tripId, "revision-write");
    const [trip] = await tx
      .select({ startsAt: trips.startsAt })
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
      .limit(1)
      .for("update");
    if (!trip) return { ok: false as const, reason: "not_found" as const };
    if (await departureMayBeAtSea(tx, { shopId, tripId, startsAt: trip.startsAt, now })) {
      return { ok: false as const, reason: "trip_departed" as const };
    }
    await setTripStatus(tx, shopId, tripId, "cancelled", now, options);
    return { ok: true as const };
  });
}

/** The newest departure-checkpoint word per seat, `cleared` included. */
async function dockWordBySeat(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  bookingIds: readonly string[] | undefined,
): Promise<Map<string, "boarded" | "not_boarded" | "cleared">> {
  const rows = await db
    .select({ bookingId: rollCallEvents.bookingId, status: rollCallEvents.status })
    .from(rollCallEvents)
    .where(
      and(
        eq(rollCallEvents.shopId, shopId),
        eq(rollCallEvents.tripId, tripId),
        eq(rollCallEvents.checkpoint, "departure"),
        bookingIds ? inArray(rollCallEvents.bookingId, [...bookingIds]) : undefined,
      ),
    )
    .orderBy(
      desc(rollCallEvents.occurredAt),
      desc(rollCallEvents.createdAt),
      desc(rollCallEvents.seq),
    );
  const dock = new Map<string, "boarded" | "not_boarded" | "cleared">();
  for (const row of rows) if (!dock.has(row.bookingId)) dock.set(row.bookingId, row.status);
  return dock;
}

/**
 * The crew list's standing dock word for this person is "not boarded", and
 * they are still on this departure's crew: a staffer who holds a seat and was
 * marked ashore on the crew half of the count.
 */
async function crewMarkedAshore(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  personId: string,
): Promise<boolean> {
  const [newest] = await db
    .select({ status: rollCallCrewEvents.status })
    .from(rollCallCrewEvents)
    .innerJoin(
      tripAssignments,
      and(
        eq(tripAssignments.tripId, rollCallCrewEvents.tripId),
        eq(tripAssignments.personId, rollCallCrewEvents.personId),
      ),
    )
    .where(
      and(
        eq(rollCallCrewEvents.shopId, shopId),
        eq(rollCallCrewEvents.tripId, tripId),
        eq(rollCallCrewEvents.personId, personId),
        eq(rollCallCrewEvents.checkpoint, "departure"),
      ),
    )
    .orderBy(
      desc(rollCallCrewEvents.occurredAt),
      desc(rollCallCrewEvents.createdAt),
      desc(rollCallCrewEvents.seq),
    )
    .limit(1);
  return newest?.status === "not_boarded";
}

/**
 * **The diver's own doors ask the same question, only where it can change the
 * answer** (H-20261015-aboard-diver-removal-at): the ready page's Cancel, the reply keyword's candidates
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
): Promise<Map<string, AboardHold>> {
  const { startsAt, now } = input;
  if (input.bookingIds.length === 0) return new Map();
  if (hasSailed(startsAt, now) || !departureUnderway({ startsAt, rollCallStarted: false }, now)) {
    return new Map();
  }
  return aboardAtSeaBookingIds(db, input);
}
