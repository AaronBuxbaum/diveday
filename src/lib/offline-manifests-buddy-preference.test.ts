import { expect, it } from "vitest";
import { EMPTY_EMERGENCY_REFERENCE } from "./emergency-reference";
import type { TripManifest } from "./manifests";
import { serializeManifests } from "./offline-manifests";

function baseManifest(): TripManifest {
  return {
    trip: {
      id: "trip-1",
      title: "Two-Tank Reef",
      startsAt: new Date("2026-07-20T12:00:00.000Z"),
      endsAt: new Date("2026-07-20T16:00:00.000Z"),
      plannedDives: 2,
    },
    checkpoint: "after_dive_1",
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
        fullName: "Nobody Asked",
        email: "nobody@example.com",
        emergencyContactName: null,
        emergencyContactPhone: null,
        readiness: { status: "ready", blockers: [] },
        rentalFit: { state: "own_kit" },
        nitroxRequested: false,
        checkedIn: false,
        rollCall: undefined,
        buddyAlert: null,
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

it.each([undefined, true, false])(
  "honors the optional buddy preference %s for both saved crew and diver references without changing source teams",
  (buddyTeamsEnabled) => {
    const manifest = baseManifest();
    const diver = manifest.divers[0];
    if (!diver) throw new Error("expected fixture diver");
    diver.buddyTeam = {
      teamId: "team-diver",
      others: [{ kind: "crew", personId: "crew-1", fullName: "Keiko Tanaka" }],
    };
    manifest.crew = [
      {
        id: "crew-1",
        fullName: "Keiko Tanaka",
        roles: ["divemaster"],
        standingRatings: [],
        emergencyContactName: null,
        emergencyContactPhone: null,
        buddyAlert: null,
        buddyTeams: [
          {
            teamId: "team-crew",
            others: [{ kind: "diver", bookingId: diver.bookingId, fullName: diver.fullName }],
          },
        ],
      },
    ];
    const before = structuredClone(manifest);
    const payload = serializeManifests(
      [manifest],
      {
        slug: "blue-mantis",
        name: "Blue Mantis",
        timezone: "America/New_York",
        emergencyReference: EMPTY_EMERGENCY_REFERENCE,
        buddyTeamsEnabled,
      },
      (blocker) => blocker.code,
    );
    const saved = payload.manifests[0];
    if (buddyTeamsEnabled === false) {
      expect(saved?.crew[0]).not.toHaveProperty("buddyTeamNames");
      expect(saved?.divers[0]).not.toHaveProperty("buddyTeamNames");
    } else {
      expect(saved?.crew[0]?.buddyTeamNames).toEqual([diver.fullName]);
      expect(saved?.divers[0]?.buddyTeamNames).toEqual(["Keiko Tanaka"]);
    }
    expect(manifest).toEqual(before);
  },
);
