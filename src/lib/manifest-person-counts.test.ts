import { describe, expect, it } from "vitest";
import { boardedAt, crewMember, trip } from "@/test/substrate-fixtures/lib/manifest-test-fixtures";
import { physicalPeople } from "./manifest-person-counts";
import { buildTripManifest } from "./manifests";

describe("physical people across operational roles", () => {
  it("keeps every crew row on an older copy without identities", () => {
    expect(physicalPeople([], [{}, {}])).toBe(2);
  });
  it("counts one human with a booking and crew assignment once", () => {
    expect(physicalPeople([{ bookingId: "seat", personId: "priya" }], [{ id: "priya" }])).toBe(1);
  });
  it("keeps an unconfirmed passenger distinct even with a matching crew identity", () => {
    const passenger = { bookingId: "seat", personId: "priya" };
    const crew = [{ id: "priya" }];
    expect(
      physicalPeople(
        [{ ...passenger, readiness: { blockers: [{ code: "identity_unconfirmed" }] } }],
        crew,
      ),
    ).toBe(2);
    expect(
      physicalPeople([{ ...passenger, readiness: { blockers: [{ code: "medical" }] } }], crew),
    ).toBe(1);
    expect(physicalPeople([{ ...passenger, readiness: { blockers: [] } }], crew)).toBe(1);
  });
  it("never guesses identity from a name, a held match, or an older copy", () => {
    expect(physicalPeople([{ bookingId: "seat" }], [{ id: "priya" }])).toBe(2);
    expect(
      physicalPeople(
        [{ bookingId: "seat", personId: "priya", identityClaim: {} }],
        [{ id: "priya" }],
      ),
    ).toBe(2);
    expect(
      physicalPeople(
        [{ bookingId: "seat", personId: "priya", identityWithheld: true }],
        [{ id: "priya" }],
      ),
    ).toBe(2);
    expect(physicalPeople([{ bookingId: "seat", personId: "other" }], [{ id: "priya" }])).toBe(2);
  });
});

it("compares the hull capacity with physical people while preserving role counts", () => {
  const manifest = buildTripManifest({
    trip: { ...trip, capacity: 1, boatCapacity: 1 },
    checkpoint: "departure",
    divers: [
      {
        bookingId: "seat",
        personId: "priya",
        fullName: "Priya",
        email: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        checkedIn: false,
        rentalFit: { state: "own_kit" },
        nitroxRequested: false,
        readiness: { status: "ready", blockers: [] },
        rollCall: boardedAt(),
      },
    ],
    crew: [
      crewMember({ id: "priya", fullName: "Priya", roles: ["divemaster"], rollCall: boardedAt() }),
    ],
  });
  expect(manifest.summary.boarded).toBe(1);
  expect(manifest.crew).toHaveLength(1);
  expect(manifest.summary.overBoatCapacity).toBe(0);
});
