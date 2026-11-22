/**
 * Properties of `buildTripManifest`'s head counts (src/lib/manifests.ts):
 * every passenger type holds a seat against the departure's capacity, the
 * boat's own capacity counts crew aboard too, and after a dive anyone with no
 * result or a stated "not back" is unaccounted for. Example tests:
 * manifests-capacity.test.ts.
 */
import fc from "fast-check";
import { describe, expect } from "vitest";
import { property } from "@/test/property";
import {
  boardedAt,
  crewMember,
  notBoardedAt,
  trip,
} from "../test/substrate-fixtures/lib/manifest-test-fixtures";
import { buildTripManifest, type ManifestDiverInput, type RollCallRecord } from "./manifests";
import { countParticipants, PARTICIPANT_TYPES, type ParticipantType } from "./participant-types";

/** A result at this checkpoint: none yet, aboard, stated ashore, or ashore carried from the dock. */
type Result = "none" | "boarded" | "not_boarded" | "implied";

function rollCallOf(result: Result): RollCallRecord | undefined {
  if (result === "none") return undefined;
  if (result === "boarded") return boardedAt();
  if (result === "not_boarded") return notBoardedAt();
  return { ...notBoardedAt(), implied: true };
}

function passenger(
  index: number,
  participantType: ParticipantType,
  result: Result,
): ManifestDiverInput {
  return {
    bookingId: `booking-${index}`,
    personId: `passenger-${index}`,
    fullName: `Passenger ${index}`,
    participantType,
    email: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    rentalFit: { state: "not_recorded" },
    nitroxRequested: false,
    checkedIn: false,
    rollCall: rollCallOf(result),
  };
}

const arbResult = fc.constantFrom<Result>("none", "boarded", "not_boarded", "implied");
const arbPassengers = fc.array(fc.tuple(fc.constantFrom(...PARTICIPANT_TYPES), arbResult), {
  maxLength: 20,
});
const arbCrew = fc.array(fc.constantFrom<Result>("none", "boarded", "not_boarded"), {
  maxLength: 5,
});

describe("manifest head count", () => {
  /**
   * Over capacity counts every boarded passenger, whatever they are doing,
   * and the count by type sums to everyone on the list.
   */
  property(
    "over-capacity is blind to participant type",
    [arbPassengers, fc.nat(20)],
    (rows, capacity) => {
      const manifest = buildTripManifest({
        trip: { ...trip, capacity },
        crew: [],
        divers: rows.map(([type, result], index) => passenger(index, type, result)),
      });
      const boarded = rows.filter(([, result]) => result === "boarded").length;
      expect(manifest.summary.overCapacity).toBe(Math.max(0, boarded - capacity));
      expect(manifest.summary.byType).toEqual(
        countParticipants(rows.map(([participantType]) => ({ participantType }))),
      );
      expect(manifest.summary.totalDivers).toBe(rows.length);
    },
    { runs: 150 },
  );

  /**
   * The boat's own capacity counts every person aboard: boarded passengers of
   * any type and boarded crew, never someone ashore or not yet answered for.
   */
  property(
    "over boat capacity counts boarded crew too",
    [arbPassengers, arbCrew, fc.nat(25)],
    (rows, crewResults, boatCapacity) => {
      const manifest = buildTripManifest({
        trip: { ...trip, capacity: 100, boatCapacity },
        crew: crewResults.map((result, index) =>
          crewMember({
            id: `crew-${index}`,
            fullName: `Crew ${index}`,
            roles: [],
            rollCall: rollCallOf(result),
          }),
        ),
        divers: rows.map(([type, result], index) => passenger(index, type, result)),
      });
      const aboard =
        rows.filter(([, result]) => result === "boarded").length +
        crewResults.filter((result) => result === "boarded").length;
      expect(manifest.summary.overBoatCapacity).toBe(Math.max(0, aboard - boatCapacity));
    },
    { runs: 150 },
  );

  /**
   * After a dive, every passenger of any type with no result or a stated
   * "not boarded" is unaccounted for; one carried ashore from the dock (never
   * left) is accounted for. At departure only a missing result is open.
   */
  property(
    "after a dive anyone unanswered or not back is unaccounted for",
    [
      arbPassengers,
      fc.constantFrom("departure" as const, "after_dive_1" as const, "after_dive_2" as const),
    ],
    (rows, checkpoint) => {
      const manifest = buildTripManifest({
        trip: { ...trip, capacity: 100 },
        checkpoint,
        crew: [],
        divers: rows.map(([type, result], index) => passenger(index, type, result)),
      });
      const open = rows.filter(
        ([, result]) =>
          result === "none" || (checkpoint !== "departure" && result === "not_boarded"),
      ).length;
      expect(manifest.summary.unaccountedFor).toBe(open);
    },
    { runs: 150 },
  );
});
