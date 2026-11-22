/**
 * Properties of `seatRefusal`, `typeChangeRefusal` and `countParticipants`
 * (src/lib/participant-types.ts), with `divemasterRatioGap`
 * (src/lib/divemaster-ratio.ts): the boat counts everyone, the divers-only
 * limit and the divemaster target count divers alone (ADR
 * 20261007-participant-types). The booking transaction calls `seatRefusal`
 * under the trip-row lock; the race itself is pinned by the real-Postgres
 * suite, not here.
 */
import fc from "fast-check";
import { describe, expect } from "vitest";
import { property } from "@/test/property";
import { divemasterRatioGap } from "./divemaster-ratio";
import {
  countParticipants,
  diverSeatLimit,
  isDiver,
  PARTICIPANT_TYPES,
  type ParticipantType,
  seatRefusal,
  typeChangeRefusal,
} from "./participant-types";

const arbType = fc.constantFrom(...PARTICIPANT_TYPES);
const arbTrip = fc.record({
  capacity: fc.integer({ min: 0, max: 30 }),
  diverCapacity: fc.option(fc.integer({ min: 0, max: 40 }), { nil: null }),
});

/** Seat each arrival in turn through `seatRefusal`, as the booking transaction does. */
function seatInTurn(
  trip: { capacity: number; diverCapacity: number | null },
  arrivals: readonly ParticipantType[],
) {
  const seated: { participantType: ParticipantType }[] = [];
  const refusals: { type: ParticipantType; refusal: string; aboard: number; divers: number }[] = [];
  for (const type of arrivals) {
    const counts = countParticipants(seated);
    const held = { aboard: seated.length, divers: counts.diver };
    const refusal = seatRefusal(type, trip, held);
    if (refusal) refusals.push({ type, refusal, ...held });
    else seated.push({ participantType: type });
  }
  return { seated, refusals };
}

describe("seating mixed participant types", () => {
  /**
   * However a mixed party arrives, the boat never holds more people than its
   * capacity, and never more divers than the divers-only limit; snorkelers
   * and riders count against the boat and never against the divers' limit.
   */
  property(
    "never oversells the boat or the divers-only limit",
    [arbTrip, fc.array(arbType, { maxLength: 40 })],
    (trip, arrivals) => {
      const { seated, refusals } = seatInTurn(trip, arrivals);
      const counts = countParticipants(seated);
      expect(seated.length).toBeLessThanOrEqual(trip.capacity);
      const limit = diverSeatLimit(trip);
      if (limit !== null) expect(counts.diver).toBeLessThanOrEqual(limit);
      for (const refused of refusals) {
        if (refused.refusal === "divers_full") expect(isDiver(refused.type)).toBe(true);
        if (refused.refusal === "trip_full") expect(refused.aboard).toBe(trip.capacity);
      }
    },
  );

  /** Nobody is refused while the boat has room and the divers' limit is not what binds. */
  property(
    "a refusal is only ever for a full boat or full diver seats",
    [arbTrip, fc.array(arbType, { maxLength: 40 })],
    (trip, arrivals) => {
      const limit = diverSeatLimit(trip);
      for (const refused of seatInTurn(trip, arrivals).refusals) {
        const boatFull = refused.aboard >= trip.capacity;
        const diversFull = limit !== null && isDiver(refused.type) && refused.divers >= limit;
        expect(boatFull || diversFull).toBe(true);
      }
    },
  );

  /** A seat changing type keeps its place on the boat: only becoming a diver can be refused. */
  property(
    "a type change is refused only when it becomes a diver's seat",
    [arbType, arbType, arbTrip, fc.nat(40), fc.nat(40)],
    (from, to, trip, aboard, divers) => {
      const refusal = typeChangeRefusal(from, to, trip, { aboard, divers });
      if (refusal !== null) expect(!isDiver(from) && isDiver(to)).toBe(true);
    },
  );

  /** A head count by type counts every row exactly once, absent as a diver. */
  property(
    "the head count is everyone",
    [fc.array(fc.option(arbType, { nil: null }), { maxLength: 40 })],
    (types) => {
      const counts = countParticipants(types.map((participantType) => ({ participantType })));
      expect(counts.diver + counts.snorkeler + counts.rider).toBe(types.length);
      expect(counts.diver).toBe(types.filter((type) => type === null || type === "diver").length);
    },
  );

  /**
   * The divemaster target reads divers alone: a gap is reported exactly when
   * the divemasters on board are fewer than one per `ratio` divers, rounded up,
   * and an empty boat is never short.
   */
  property(
    "the divemaster gap closes once there is one per ratio divers",
    [fc.nat(60), fc.nat(10), fc.integer({ min: 1, max: 20 })],
    (divers, divemasterCount, ratio) => {
      const gap = divemasterRatioGap({ divers, divemasterCount, diversPerDivemaster: ratio });
      const enough = divemasterCount * ratio >= divers;
      expect(gap.code).toBe(enough ? "none" : "under_target");
      if (gap.code === "under_target") expect(gap.shortBy).toBeGreaterThan(0);
    },
  );
});
