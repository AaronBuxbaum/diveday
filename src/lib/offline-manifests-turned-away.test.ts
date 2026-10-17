import { describe, expect, it } from "vitest";
import { EMPTY_EMERGENCY_REFERENCE } from "./emergency-reference";
import type { TripManifest } from "./manifests";
import { serializeManifests } from "./offline-manifests";

const SHOP = {
  slug: "blue-mantis",
  name: "Blue Mantis",
  timezone: "America/New_York",
  emergencyReference: EMPTY_EMERGENCY_REFERENCE,
};

/** One diver on one departure, released at the desk, as `getTripManifest` shapes it. */
function released(over: { turnedAway?: boolean }): TripManifest {
  return {
    trip: {
      id: "trip-1",
      title: "Two-Tank Reef",
      startsAt: new Date("2026-07-20T12:00:00.000Z"),
      endsAt: new Date("2026-07-20T16:00:00.000Z"),
      plannedDives: 2,
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
        fullName: "Tess Away",
        email: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        readiness: { status: "blocked", blockers: [{ code: "waiver_not_sent" }] },
        rentalFit: { state: "own_kit" },
        nitroxRequested: false,
        checkedIn: false,
        notHere: true,
        ...(over.turnedAway ? { turnedAway: true } : {}),
        rollCall: undefined,
        buddyAlert: null,
      },
    ],
    summary: {
      totalDivers: 1,
      ready: 0,
      blocked: 1,
      boarded: 0,
      notBoarded: 0,
      notBackAboard: 0,
      awaiting: 1,
      unaccountedFor: 1,
      overCapacity: 0,
      notHere: 1,
    },
  } as TripManifest;
}

/**
 * **The dock copy tells a turn-away from a write-off** (layer 3 review, dde-1
 * F3). The copy on a crew phone is the only one at the rail with no signal,
 * and it badged a diver the desk saw and refused "Not here", the opposite
 * statement. `turnedAway` rides beside `notHere`, optional and additive, so
 * no record-version bump purges a captain's queued roll call.
 */
describe("serializeManifests, a seat the desk turned away", () => {
  it("carries the turn-away beside the release", () => {
    const payload = serializeManifests([released({ turnedAway: true })], SHOP, (b) => b.code);
    expect(payload.manifests[0]?.divers[0]).toMatchObject({ notHere: true, turnedAway: true });
  });

  it("carries nothing extra for a plain write-off", () => {
    const payload = serializeManifests([released({})], SHOP, (b) => b.code);
    expect(payload.manifests[0]?.divers[0]?.notHere).toBe(true);
    expect(payload.manifests[0]?.divers[0]).not.toHaveProperty("turnedAway");
  });
});
