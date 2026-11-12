import { expect, it } from "vitest";
import { trip } from "@/test/substrate-fixtures/lib/manifest-test-fixtures";
import { EMPTY_EMERGENCY_REFERENCE } from "./emergency-reference";
import { buildTripManifest } from "./manifests";
import { serializeManifests } from "./offline-manifests";

it("carries confirmed physical identity but never a held person's identifier", () => {
  const manifest = buildTripManifest({
    trip,
    checkpoint: "departure",
    crew: [],
    divers: [
      {
        bookingId: "seat",
        personId: "private-person",
        fullName: "Private Name",
        email: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        checkedIn: false,
        rentalFit: { state: "own_kit" },
        nitroxRequested: false,
        readiness: { status: "ready", blockers: [] },
      },
    ],
  });
  const shop = {
    slug: "test",
    name: "Test",
    timezone: "UTC",
    emergencyReference: EMPTY_EMERGENCY_REFERENCE,
  };
  expect(serializeManifests([manifest], shop, () => "").manifests[0]?.divers[0]?.personId).toBe(
    "private-person",
  );
  const passenger = manifest.divers[0];
  if (!passenger) throw new Error("passenger fixture missing");
  passenger.identityClaim = { bookedAs: "Held Name" };
  const held = serializeManifests([manifest], shop, () => "");
  expect(held.manifests[0]?.divers[0]?.personId).toBeUndefined();
  expect(JSON.stringify(held)).not.toContain("private-person");
});
