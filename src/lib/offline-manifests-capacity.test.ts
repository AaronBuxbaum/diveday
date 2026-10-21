import { expect, it } from "vitest";
import { EMPTY_EMERGENCY_REFERENCE } from "./emergency-reference";
import { buildTripManifest } from "./manifests";
import { serializeManifests } from "./offline-manifests";

it("keeps the boat's total-person certificate limit through the saved JSON", () => {
  const manifest = buildTripManifest({
    trip: {
      id: "trip-1",
      title: "Two-Tank Reef",
      startsAt: new Date("2026-07-20T12:00:00.000Z"),
      endsAt: new Date("2026-07-20T16:00:00.000Z"),
      plannedDives: 2,
      certifiedTotalPersons: 12,
    },
    checkpoint: "departure",
    crew: [],
    divers: [],
  });
  const payload = serializeManifests(
    [manifest],
    {
      slug: "blue-mantis",
      name: "Blue Mantis",
      timezone: "America/New_York",
      emergencyReference: EMPTY_EMERGENCY_REFERENCE,
    },
    (blocker) => blocker.code,
  );
  expect(JSON.parse(JSON.stringify(payload)).manifests[0].trip.certifiedTotalPersons).toBe(12);
  expect(payload.manifests[0]?.trip.certifiedTotalPersons).toBe(12);
});
