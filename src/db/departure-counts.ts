import { and, desc, eq, inArray } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { seatSailed } from "@/lib/closeout";
import { SEAT_HELD_STATUSES } from "@/lib/no-show";
import type { ReadinessResult } from "@/lib/readiness";
import { type RollCallCheckpoint, rollCallCheckpointOrdinal } from "@/lib/roll-call";
import { rosterRowIsBlocked } from "@/lib/roster-filters";
import type { DbExecutor } from "./client";
import { queryAll } from "./query-helpers";
import { listTripsReadiness } from "./readiness";
import { bookings, rollCallEvents, trips } from "./schema";
import { liveTrip } from "./trips-live";
import { seatNotCancelled } from "./trips-queries";

/**
 * **One departure's head count**, each number defined once (issue #2785).
 *
 * Every number here counts **seats on the roster, divers and other passengers
 * alike**; crew are never in it. Each field answers one question, and a
 * surface that wants another question asks for another field rather than
 * doing arithmetic on these: `sailed - back` is **not** the number still in
 * the water, because a seat the crew have not yet reached at the current
 * count is neither back nor missing.
 */
export type DepartureCount = Readonly<{
  /** The places the departure offers (`trips.capacity`). */
  capacity: number;
  /**
   * **Seats held**: booked or checked in. A no-show has released its place and
   * is not here; a cancelled seat is nobody. This is the number set against
   * `capacity` before the boat leaves.
   */
  booked: number;
  /**
   * **Seats the boat carried**, by `seatSailed` (`src/lib/closeout.ts`), the
   * rule the evening close-out reads: the crew's word at the dock wins, then
   * any standing after-dive word, then the desk's no-show mark.
   *
   * Before anyone has counted at the dock this is every seat not marked a
   * no-show, because that rule's last fallback is the desk. Read it as "who
   * went out" only once the boat has left.
   */
  sailed: number;
  /**
   * **Seats counted aboard at the dock**: the standing departure result is
   * `boarded`. The same answer as `listDepartureBoardedByTrip`. A diver first
   * counted at a later site is in `sailed` and `back` but not here.
   */
  boarded: number;
  /**
   * **Seats that sailed and are counted back aboard at the latest after-dive
   * checkpoint anyone on this departure has been counted at.** Zero until the
   * first after-dive count.
   *
   * Only a standing `boarded` at that checkpoint counts. A seat recorded not
   * back, a seat nobody has named at that checkpoint yet, and a seat whose
   * word there was retracted are all not back. So the number can be low while
   * a count is still being taken, and never high: it is the side a head count
   * may err on.
   */
  back: number;
  /**
   * **Seats on the roster whose readiness says they may not board**
   * (`rosterRowIsBlocked`), counted over the same seats the roster's Blocked
   * chip counts, a no-show included, so the two never disagree. It informs;
   * nothing here refuses anybody.
   */
  blocked: number;
}>;

type StandingResult = "boarded" | "not_boarded";

/** One seat's standing words: the dock's, and each after-dive checkpoint's by ordinal. */
type SeatWords = { dock: StandingResult | null; afterDive: Map<number, StandingResult> };

/**
 * **The head count of each departure asked about**, from one roster read and
 * one roll-call read. A departure that is not this shop's, or is deleted, is
 * absent from the map.
 *
 * `readiness` is each seat's readiness by booking id, for a caller that has
 * already read the roster's readiness (the trip page does). Without it, this
 * reads it through `listTripsReadiness`, the roster's own pipeline.
 *
 * Every roll-call word follows the supersession every reader in
 * `src/db/manifests.ts` applies: the newest event per seat and checkpoint
 * stands, and a newest `cleared` takes that checkpoint's word away.
 */
export async function departureCounts(
  db: DbExecutor,
  shopId: string,
  tripIds: readonly string[],
  options: { now?: Date; readiness?: ReadonlyMap<string, ReadinessResult | undefined> } = {},
): Promise<Map<string, DepartureCount>> {
  const counts = new Map<string, DepartureCount>();
  const ids = [...new Set(tripIds)];
  if (ids.length === 0) return counts;

  const readinessRead = (): Promise<ReadonlyMap<string, ReadinessResult | undefined>> =>
    options.readiness
      ? Promise.resolve(options.readiness)
      : listTripsReadiness(db, shopId, ids, options.now ?? nowDate()).then(
          (rows) => new Map(rows.map((row) => [row.booking.id, row.readiness])),
        );
  // `queryAll`, not `Promise.all`: inside a transaction these share one client.
  const [roster, events, readiness] = await queryAll(db, [
    () =>
      db
        .select({
          tripId: trips.id,
          capacity: trips.capacity,
          bookingId: bookings.id,
          status: bookings.status,
        })
        .from(trips)
        .leftJoin(
          bookings,
          and(eq(bookings.tripId, trips.id), eq(bookings.shopId, shopId), seatNotCancelled),
        )
        .where(and(eq(trips.shopId, shopId), inArray(trips.id, ids), liveTrip())),
    () =>
      db
        .select({
          bookingId: rollCallEvents.bookingId,
          checkpoint: rollCallEvents.checkpoint,
          status: rollCallEvents.status,
        })
        .from(rollCallEvents)
        .innerJoin(bookings, and(eq(bookings.id, rollCallEvents.bookingId), seatNotCancelled))
        .where(and(eq(rollCallEvents.shopId, shopId), inArray(rollCallEvents.tripId, ids)))
        .orderBy(
          desc(rollCallEvents.occurredAt),
          desc(rollCallEvents.createdAt),
          desc(rollCallEvents.seq),
        ),
    readinessRead,
  ]);

  // Newest first, so the first event per seat and checkpoint is its standing word.
  const words = new Map<string, SeatWords>();
  const seen = new Set<string>();
  for (const event of events) {
    const key = `${event.bookingId}\u0000${event.checkpoint}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (event.status === "cleared") continue;
    const seat = words.get(event.bookingId) ?? { dock: null, afterDive: new Map() };
    words.set(event.bookingId, seat);
    if (event.checkpoint === "departure") {
      seat.dock = event.status;
      continue;
    }
    const ordinal = rollCallCheckpointOrdinal(event.checkpoint as RollCallCheckpoint);
    // A checkpoint with no place in the day is not read, as `listUnaccountedForByTrip` does.
    if (ordinal >= 1 && Number.isFinite(ordinal)) seat.afterDive.set(ordinal, event.status);
  }

  const seatsByTrip = new Map<
    string,
    { capacity: number; seats: { id: string; status: string }[] }
  >();
  for (const row of roster) {
    const trip = seatsByTrip.get(row.tripId) ?? { capacity: row.capacity, seats: [] };
    seatsByTrip.set(row.tripId, trip);
    if (row.bookingId && row.status) trip.seats.push({ id: row.bookingId, status: row.status });
  }

  for (const [tripId, { capacity, seats }] of seatsByTrip) {
    // The checkpoint the boat is at: the latest one any seat here has a standing word at.
    let latest = 0;
    for (const seat of seats) {
      for (const ordinal of words.get(seat.id)?.afterDive.keys() ?? []) {
        latest = Math.max(latest, ordinal);
      }
    }
    let booked = 0;
    let sailed = 0;
    let boarded = 0;
    let back = 0;
    let blocked = 0;
    for (const seat of seats) {
      const held = (SEAT_HELD_STATUSES as readonly string[]).includes(seat.status);
      const said = words.get(seat.id);
      const seatHasSailed = seatSailed({
        noShow: seat.status === "no_show",
        dockResult: said?.dock ?? null,
        afterDiveResultStands: (said?.afterDive.size ?? 0) > 0,
      });
      if (held) booked += 1;
      if (seatHasSailed) sailed += 1;
      if (said?.dock === "boarded") boarded += 1;
      if (seatHasSailed && latest > 0 && said?.afterDive.get(latest) === "boarded") back += 1;
      if (rosterRowIsBlocked(readiness.get(seat.id))) blocked += 1;
    }
    counts.set(tripId, Object.freeze({ capacity, booked, sailed, boarded, back, blocked }));
  }
  return counts;
}
