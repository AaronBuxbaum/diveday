import { describe, expect, it } from "vitest";
import { EMPTY_EMERGENCY_REFERENCE } from "./emergency-reference";
import type { TripManifest } from "./manifests";
import { serializeManifests } from "./offline-manifests";

/**
 * **The medical alert for the crew on the dock copy** (glossary *Medical
 * alert for the crew*, issue #2960): the fact rides on every copy, the words
 * only on a copy saved by a reader allowed them on this departure.
 */
const shop = {
  slug: "blue-mantis",
  name: "Blue Mantis",
  timezone: "America/New_York",
  emergencyReference: EMPTY_EMERGENCY_REFERENCE,
};

function manifestWith(diver: Partial<TripManifest["divers"][number]>): TripManifest {
  return {
    trip: {
      id: "trip-1",
      title: "Afternoon reef charter",
      startsAt: new Date("2026-07-20T12:00:00.000Z"),
      endsAt: new Date("2026-07-20T16:00:00.000Z"),
      plannedDives: 1,
    },
    checkpoint: "departure",
    crew: [],
    completeness: {
      complete: false,
      diversAccountedFor: false,
      crewAccountedFor: false,
      reason: "divers_awaiting",
      crewReason: "crew_none_assigned",
      crewCounts: { crewAwaiting: 0, crewNotBackAboard: 0, crewAshore: 0, crewAssigned: 0 },
    },
    divers: [
      {
        bookingId: "booking-1",
        fullName: "Maya Ortiz",
        email: "maya@example.com",
        emergencyContactName: null,
        emergencyContactPhone: null,
        readiness: { status: "ready", blockers: [] },
        rentalFit: { state: "own_kit" },
        nitroxRequested: false,
        checkedIn: false,
        rollCall: undefined,
        buddyAlert: null,
        ...diver,
      },
    ],
    summary: {
      totalDivers: 1,
      ready: 1,
      blocked: 0,
      boarded: 0,
      notBoarded: 0,
      notBackAboard: 0,
      awaiting: 1,
      unaccountedFor: 1,
      overCapacity: 0,
      notHere: 0,
    },
  } as TripManifest;
}

const ALERT = "Bee-sting allergy. EpiPen in the blue dry bag.";

const save = (
  diver: Partial<TripManifest["divers"][number]>,
  texts?: ReadonlyMap<string, string>,
) =>
  serializeManifests(
    [manifestWith(diver)],
    shop,
    (blocker) => blocker.code,
    [],
    null,
    undefined,
    texts,
  ).manifests[0]?.divers[0] as Record<string, unknown>;

describe("the dock copy of a medical alert", () => {
  it("carries the words for a reader allowed them on this departure", () => {
    expect(save({ medicalAlert: true }, new Map([["booking-1", ALERT]])).medicalAlert).toEqual({
      text: ALERT,
    });
  });

  it("carries the fact and no words for anyone else", () => {
    const row = save({ medicalAlert: true });
    expect(row.medicalAlert).toEqual({});
    expect(JSON.stringify(row)).not.toContain("EpiPen");
    // Another seat's words never land on this one.
    expect(save({ medicalAlert: true }, new Map([["booking-2", ALERT]])).medicalAlert).toEqual({});
  });

  it("writes no field for a diver with no alert, even if a text was passed", () => {
    expect("medicalAlert" in save({})).toBe(false);
    expect("medicalAlert" in save({ medicalAlert: false }, new Map([["booking-1", ALERT]]))).toBe(
      false,
    );
  });

  it("never carries it on a held seat", () => {
    const row = save(
      {
        medicalAlert: true,
        identityClaim: { bookedAs: "Someone Else", matchedBy: null },
        readiness: { status: "blocked", blockers: [{ code: "identity_unconfirmed" }] },
      },
      new Map([["booking-1", ALERT]]),
    );
    expect(row.identityWithheld).toBe(true);
    expect("medicalAlert" in row).toBe(false);
    expect(JSON.stringify(row)).not.toContain("EpiPen");
  });
});
