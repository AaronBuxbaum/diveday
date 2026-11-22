/**
 * Properties of `buildTripManifest`'s capacity summary (src/lib/manifests.ts):
 * every passenger type holds a seat against the departure's capacity.
 * Example tests: manifests-capacity.test.ts.
 */
import fc from "fast-check";
import { describe, expect } from "vitest";
import { property } from "@/test/property";
import { boardedAt, trip } from "../test/substrate-fixtures/lib/manifest-test-fixtures";
import { buildTripManifest, type ManifestDiverInput } from "./manifests";
import { countParticipants, PARTICIPANT_TYPES, type ParticipantType } from "./participant-types";

function passenger(index: number, participantType: ParticipantType): ManifestDiverInput {
  return {
    bookingId: `booking-${index}`,
    fullName: `Passenger ${index}`,
    participantType,
    email: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    rentalFit: { state: "not_recorded" },
    nitroxRequested: false,
    checkedIn: false,
    rollCall: boardedAt(),
  };
}

describe("manifest head count", () => {
  /**
   * Over capacity counts every boarded passenger, whatever they are doing:
   * the same boat with any mix of divers, snorkelers and riders reports
   * boarded less capacity, and the count by type sums to everyone.
   */
  property(
    "over-capacity is blind to participant type",
    [fc.array(fc.constantFrom(...PARTICIPANT_TYPES), { maxLength: 20 }), fc.nat(20)],
    (types, capacity) => {
      const manifest = buildTripManifest({
        trip: { ...trip, capacity },
        crew: [],
        divers: types.map((type, index) => passenger(index, type)),
      });
      expect(manifest.summary.overCapacity).toBe(Math.max(0, types.length - capacity));
      expect(manifest.summary.byType).toEqual(
        countParticipants(types.map((participantType) => ({ participantType }))),
      );
      expect(manifest.summary.totalDivers).toBe(types.length);
    },
    { runs: 100 },
  );
});
