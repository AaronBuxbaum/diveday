import { and, desc, eq, inArray } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { seatSailed } from "@/lib/seat-sailed";
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
 * **One departure's passenger count**, each number defined once (issue #2785).
 *
 * Every number here counts **seats on the roster, divers and other passengers
 * alike**. **Crew are never in it**: their roll call is
 * `listDepartureCrewRollCallByTrip`, so no surface may say "everyone is back"
 * from this record alone. Each field answers one question, and a surface that
 * wants another asks for another field rather than doing arithmetic on these:
 * `sailed - back` is **not** the number still in the water (that is `missing`),
 * because a seat the crew have not yet reached at the current count is
 * neither back nor missing.
 */
export type DepartureCount = Readonly<{
  /** The places the departure offers (`trips.capacity`). */
  capacity: number;
  /**
   * **Seats held**: booked or checked in. A no-show has released its place and
   * is not here; a cancelled seat is nobody. This is the number set against
   * `capacity` before the boat leaves. Not the close-out's `booked`
   * (`CloseoutTripInput`), which is the whole roster, no-shows included.
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
   *
   * It asks how many the vessel *left the dock with*, so a seat the crew
   * marked `not_boarded` at the dock stays out of it even when a chase boat
   * brought that diver out later. `back` and `missing` do not lean on it for
   * that reason: they read the after-dive words themselves.
   */
  sailed: number;
  /**
   * **Seats counted aboard at the dock**: the standing departure result is
   * `boarded`. The same answer as `listDepartureBoardedByTrip`. A diver first
   * counted at a later site is never here. A seat the desk marked a no-show
   * and the crew counted aboard anyway is here and in `sailed` but not in
   * `booked`, so `boarded` can exceed `booked` by exactly those seats.
   */
  boarded: number;
  /**
   * **Seats counted back aboard at the current after-dive checkpoint**: the
   * latest one, within the departure's planned dives, that anyone on it has a
   * standing word at. Zero until the first after-dive count.
   *
   * Only a standing `boarded` at that checkpoint counts. A seat recorded not
   * back, a seat nobody has named at that checkpoint yet, and a seat whose
   * word there was retracted are all not back. So the number can be low while
   * a count is still being taken, and never high: it is the side a head count
   * may err on. A diver a chase boat brought out counts here once counted
   * aboard, even though `sailed` leaves them out, so `back` can exceed
   * `sailed` by exactly those seats.
   */
  back: number;
  /**
   * **Seats recorded not back aboard and not counted aboard since**: the
   * newest word at some after-dive checkpoint is `not_boarded` and no later
   * after-dive checkpoint has a standing `boarded`. The dock is never read
   * (`not_boarded` there means "never left"). The same rule and the same
   * answer as `listUnaccountedForByTrip`, the divers a departure must not be
   * called finished over. Read at every checkpoint, planned or not, so a
   * stray tap can never hide one.
   */
  missing: number;
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

  // `queryAll`, not `Promise.all`: inside a transaction these share one client.
  const [roster, events] = await queryAll(db, [
    () =>
      db
        .select({
          tripId: trips.id,
          capacity: trips.capacity,
          plannedDives: trips.plannedDives,
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
          tripId: rollCallEvents.tripId,
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
  ]);
  const readiness = await readinessFor(db, shopId, roster, options);

  // Newest first, so the first event per seat and checkpoint is its standing word.
  // Keyed by departure too: a word recorded on another departure (an offline
  // mark that synced after the seat moved) is never this departure's.
  const words = new Map<string, SeatWords>();
  const seatKey = (tripId: string, bookingId: string) => `${tripId}\u0000${bookingId}`;
  // Supersession is keyed on the checkpoint's place in the day (the dock is 0),
  // not its spelling: two spellings of one checkpoint ("after_dive_02" beside
  // "after_dive_2", from imported or hand-written rows) are one checkpoint, and
  // the newest word at it stands.
  const seen = new Set<string>();
  for (const event of events) {
    const ordinal = rollCallCheckpointOrdinal(event.checkpoint as RollCallCheckpoint);
    // A checkpoint with no place in the day is not read, as `listUnaccountedForByTrip` does.
    if (!Number.isInteger(ordinal) || ordinal < 0) continue;
    const key = `${event.tripId}\u0000${event.bookingId}\u0000${ordinal}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (event.status === "cleared") continue;
    const at = seatKey(event.tripId, event.bookingId);
    const seat = words.get(at) ?? { dock: null, afterDive: new Map() };
    words.set(at, seat);
    if (ordinal === 0) seat.dock = event.status;
    else seat.afterDive.set(ordinal, event.status);
  }

  const seatsByTrip = new Map<
    string,
    { capacity: number; plannedDives: number; seats: { id: string; status: string }[] }
  >();
  for (const row of roster) {
    const trip = seatsByTrip.get(row.tripId) ?? {
      capacity: row.capacity,
      plannedDives: row.plannedDives,
      seats: [],
    };
    seatsByTrip.set(row.tripId, trip);
    if (row.bookingId && row.status) trip.seats.push({ id: row.bookingId, status: row.status });
  }

  for (const [tripId, { capacity, plannedDives, seats }] of seatsByTrip) {
    // The checkpoint the boat is at: the latest planned one any seat here has a
    // standing word at. A stray tap past the planned dives does not move it.
    let latest = 0;
    for (const seat of seats) {
      for (const ordinal of words.get(seatKey(tripId, seat.id))?.afterDive.keys() ?? []) {
        if (ordinal <= plannedDives) latest = Math.max(latest, ordinal);
      }
    }
    let booked = 0;
    let sailed = 0;
    let boarded = 0;
    let back = 0;
    let missing = 0;
    let blocked = 0;
    for (const seat of seats) {
      const held = (SEAT_HELD_STATUSES as readonly string[]).includes(seat.status);
      const said = words.get(seatKey(tripId, seat.id));
      const seatHasSailed = seatSailed({
        noShow: seat.status === "no_show",
        dockResult: said?.dock ?? null,
        afterDiveResultStands: (said?.afterDive.size ?? 0) > 0,
      });
      if (held) booked += 1;
      if (seatHasSailed) sailed += 1;
      if (said?.dock === "boarded") boarded += 1;
      if (latest > 0 && said?.afterDive.get(latest) === "boarded") back += 1;
      if (said && isMissing(said.afterDive)) missing += 1;
      if (rosterRowIsBlocked(readiness.get(seat.id))) blocked += 1;
    }
    counts.set(
      tripId,
      Object.freeze({ capacity, booked, sailed, boarded, back, missing, blocked }),
    );
  }
  return counts;
}

/**
 * `listUnaccountedForByTrip`'s per-seat rule: the latest after-dive checkpoint
 * with a `not_boarded` is later than the latest with a `boarded`.
 */
function isMissing(afterDive: ReadonlyMap<number, StandingResult>): boolean {
  let missingAt = 0;
  let backAt = 0;
  for (const [ordinal, word] of afterDive) {
    if (word === "not_boarded") missingAt = Math.max(missingAt, ordinal);
    else backAt = Math.max(backAt, ordinal);
  }
  return missingAt > backAt;
}

/**
 * Each roster seat's readiness by booking id: the caller's map where it covers
 * every seat, and the roster's own pipeline (`listTripsReadiness`) for any
 * departure it leaves a seat out of. A seat the caller forgot never reads as
 * clear just because it is absent.
 */
async function readinessFor(
  db: DbExecutor,
  shopId: string,
  roster: readonly { tripId: string; bookingId: string | null }[],
  options: { now?: Date; readiness?: ReadonlyMap<string, ReadinessResult | undefined> },
): Promise<ReadonlyMap<string, ReadinessResult | undefined>> {
  const handed = options.readiness;
  const uncovered = new Set(
    roster.flatMap((row) => (row.bookingId && !handed?.has(row.bookingId) ? [row.tripId] : [])),
  );
  if (handed && uncovered.size === 0) return handed;
  const rows = uncovered.size
    ? await listTripsReadiness(db, shopId, [...uncovered], options.now ?? nowDate())
    : [];
  return new Map([
    ...rows.map((row) => [row.booking.id, row.readiness] as const),
    ...(handed ?? []),
  ]);
}
