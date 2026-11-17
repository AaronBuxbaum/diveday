import { expect, it } from "vitest";
import { EMPTY_EMERGENCY_REFERENCE } from "./emergency-reference";
import type { TripManifest } from "./manifests";
import { serializeManifests } from "./offline-manifests";

it("omits photos from both confirmed and held seats in the offline copy", () => {
  const photo = "/api/person-photos/private-asset";
  const diver = {
    bookingId: "confirmed",
    fullName: "Diver",
    photoPath: photo,
    email: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    readiness: { status: "ready", blockers: [] },
    rentalFit: { state: "not_recorded" },
    nitroxRequested: false,
    checkedIn: false,
    rollCall: undefined,
    buddyAlert: null,
  } as TripManifest["divers"][number];
  const manifest = {
    trip: {
      id: "trip",
      title: "Departure",
      startsAt: new Date("2026-07-20T12:00:00Z"),
      endsAt: new Date("2026-07-20T16:00:00Z"),
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
      diver,
      {
        ...diver,
        bookingId: "held",
        identityClaim: { bookedAs: "Held Diver" },
        readiness: { status: "blocked", blockers: [{ code: "identity_unconfirmed" }] },
      },
    ],
    summary: {
      totalDivers: 2,
      ready: 1,
      blocked: 1,
      boarded: 0,
      notBoarded: 0,
      notBackAboard: 0,
      awaiting: 2,
      unaccountedFor: 2,
      overCapacity: 0,
      notHere: 0,
    },
  } as TripManifest;
  const payload = serializeManifests(
    [manifest],
    { slug: "shop", name: "Shop", timezone: "UTC", emergencyReference: EMPTY_EMERGENCY_REFERENCE },
    (blocker) => blocker.code,
  );
  expect(payload.manifests[0]?.divers).toHaveLength(2);
  expect(payload.manifests[0]?.divers[1]).toMatchObject({ identityWithheld: true });
  expect(JSON.stringify(payload)).not.toContain(photo);
});
