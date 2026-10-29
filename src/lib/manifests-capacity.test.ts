import { describe, expect, it } from "vitest";
import { boardedAt, crewMember, notBoardedAt, trip } from "./manifest-test-fixtures";
import { buildTripManifest, type ManifestDiverInput } from "./manifests";

function boardedPassenger(
  bookingId: string,
  participantType: "diver" | "snorkeler" | "rider" = "diver",
): ManifestDiverInput {
  return {
    bookingId,
    fullName: bookingId,
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

describe("manifest capacity warnings", () => {
  it("compares counted passengers with trip capacity and includes every passenger type", () => {
    const manifest = buildTripManifest({
      trip: { ...trip, capacity: 2, boatCapacity: 5 },
      crew: [
        crewMember({ id: "crew-1", fullName: "Dana Reyes", roles: [], rollCall: boardedAt() }),
      ],
      divers: [
        boardedPassenger("diver"),
        boardedPassenger("snorkeler", "snorkeler"),
        boardedPassenger("rider", "rider"),
      ],
    });

    expect(manifest.summary).toMatchObject({ overCapacity: 1, overBoatCapacity: 0 });
  });

  it("compares counted passengers plus only boarded crew with boat seats", () => {
    const manifest = buildTripManifest({
      trip: { ...trip, capacity: 3, boatCapacity: 3, certifiedPassengers: 1 },
      crew: [
        crewMember({
          id: "crew-boarded",
          fullName: "Dana Reyes",
          roles: [],
          rollCall: boardedAt(),
        }),
        crewMember({ id: "crew-awaiting", fullName: "Keiko Tanaka", roles: [] }),
        crewMember({
          id: "crew-ashore",
          fullName: "Rae Kim",
          roles: [],
          rollCall: notBoardedAt(),
        }),
      ],
      divers: [boardedPassenger("diver"), boardedPassenger("snorkeler", "snorkeler")],
    });

    expect(manifest.summary).toMatchObject({ overCapacity: 0, overBoatCapacity: 0 });
  });

  it("shows both warnings when both distinct thresholds are exceeded", () => {
    const manifest = buildTripManifest({
      trip: { ...trip, capacity: 2, boatCapacity: 3 },
      crew: [
        crewMember({ id: "crew-1", fullName: "Dana Reyes", roles: [], rollCall: boardedAt() }),
      ],
      divers: [
        boardedPassenger("diver"),
        boardedPassenger("snorkeler", "snorkeler"),
        boardedPassenger("rider", "rider"),
      ],
    });

    expect(manifest.summary).toMatchObject({ overCapacity: 1, overBoatCapacity: 1 });
  });
});
